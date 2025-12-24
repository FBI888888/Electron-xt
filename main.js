const { app, BrowserWindow, ipcMain, dialog, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// 激活码验证模块
const license = require('./main/license');

let mainWindow;
let activationWindow;

let isAuthorized = false;
let lastAuthAt = 0;

const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;
const AUTH_CACHE_MS = 2 * 60 * 1000;

function getLastVerifyAtMs() {
    try {
        const info = license.getLicenseInfo();
        const raw = info && info.last_verify ? info.last_verify : null;
        const t = raw ? new Date(raw).getTime() : 0;
        return Number.isFinite(t) ? t : 0;
    } catch (e) {
        return 0;
    }
}

async function ensureAuthorized() {
    if (isAuthorized && (Date.now() - lastAuthAt) < AUTH_CACHE_MS) {
        return { success: true };
    }

    const result = await license.verify();
    if (result && result.success) {
        isAuthorized = true;
        lastAuthAt = Date.now();
        return { success: true };
    }

    if (result && result.code === 'NETWORK_ERROR') {
        const info = license.getLicenseInfo();
        const lastVerifyAt = getLastVerifyAtMs();
        const withinGrace = lastVerifyAt > 0 && (Date.now() - lastVerifyAt) <= OFFLINE_GRACE_MS;
        if (info && info.days_remaining > 0 && withinGrace) {
            isAuthorized = true;
            lastAuthAt = Date.now();
            return { success: true, offline: true };
        }
    }

    isAuthorized = false;
    lastAuthAt = 0;
    return { success: false, message: (result && result.message) ? result.message : '未授权' };
}

function wrapAuth(handler, options = {}) {
    const { returnBoolean = false, unauthorizedReturn } = options;
    return async (event, ...args) => {
        const auth = await ensureAuthorized();
        if (!auth.success) {
            if (unauthorizedReturn !== undefined) return unauthorizedReturn;
            if (returnBoolean) return false;
            return { success: false, message: auth.message || '未授权' };
        }
        return await handler(event, ...args);
    };
}

// 全局拦截外部协议（例如 bytedance://）以避免触发系统弹窗
app.on('web-contents-created', (event, contents) => {
    try {
        contents.setWindowOpenHandler(({ url }) => {
            if (url && !/^https?:\/\//i.test(url)) {
                console.log('[ProtocolBlock] blocked window.open:', url);
                return { action: 'deny' };
            }
            return { action: 'allow' };
        });

        const blockIfExternalProtocol = (e, url) => {
            if (url && !/^https?:\/\//i.test(url)) {
                console.log('[ProtocolBlock] blocked navigation:', url);
                e.preventDefault();
            }
        };

        contents.on('will-navigate', blockIfExternalProtocol);
        contents.on('will-redirect', blockIfExternalProtocol);
    } catch (e) {
        console.log('[ProtocolBlock] init failed:', e.message);
    }
});

// 获取应用根目录（项目目录）
function getAppRootPath() {
    // 开发环境下使用当前工作目录，打包后使用 app 路径
    if (app.isPackaged) {
        return path.dirname(app.getPath('exe'));
    }
    return process.cwd();
}

function createWindow() {
    // 移除菜单栏
    Menu.setApplicationMenu(null);
    
    // 获取屏幕尺寸，窗口占70%
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    const windowWidth = Math.floor(width * 0.7);
    const windowHeight = Math.floor(height * 0.8);

    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 1000,
        minHeight: 700,
        icon: path.join(__dirname, 'logo.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'default',
        show: false,
        autoHideMenuBar: true
    });

    mainWindow.loadFile('index.html');
    
    // 窗口准备好后显示
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 开发时打开调试工具
    // mainWindow.webContents.openDevTools();
}

// 创建激活窗口
function createActivationWindow() {
    Menu.setApplicationMenu(null);
    
    activationWindow = new BrowserWindow({
        width: 520,
        height: 700,
        resizable: false,
        icon: path.join(__dirname, 'logo.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'default',
        show: false,
        autoHideMenuBar: true
    });

    activationWindow.loadFile('activation.html');
    
    activationWindow.once('ready-to-show', () => {
        activationWindow.show();
    });
    
    activationWindow.on('closed', () => {
        activationWindow = null;
        // 如果激活窗口关闭且主窗口未创建，则退出应用
        if (!mainWindow) {
            app.quit();
        }
    });
}

// 应用启动流程
app.whenReady().then(async () => {
    // 设置激活数据存储路径（使用安装目录，不存到C盘）
    license.setDataPath(getAppRootPath());
    
    // 检查激活状态 - 必须连接服务器验证
    const verifyResult = await license.verify();
    
    if (verifyResult.success) {
        // 已激活，启动心跳检测并显示主窗口
        license.startHeartbeat((result) => {
            // 激活过期或被禁用时的处理
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '授权提醒',
                    message: result.message || '您的授权已失效，请重新激活',
                    buttons: ['确定']
                }).then(() => {
                    isAuthorized = false;
                    lastAuthAt = 0;
                    license.stopHeartbeat();
                    mainWindow.close();
                    createActivationWindow();
                });
            }
        });
        isAuthorized = true;
        lastAuthAt = Date.now();
        createWindow();
    } else if (verifyResult.code === 'NETWORK_ERROR') {
        // 无法连接鉴权服务器
        const choice = await dialog.showMessageBox({
            type: 'error',
            title: '连接失败',
            message: '无法连接鉴权服务器',
            detail: '请检查网络连接或联系管理员确认服务器是否正常运行。',
            buttons: ['重试', '退出']
        });
        
        if (choice.response === 0) {
            // 重试
            app.relaunch();
            app.exit(0);
        } else {
            app.quit();
        }
    } else {
        // 未激活或验证失败，显示激活窗口
        createActivationWindow();
    }
});

app.on('window-all-closed', () => {
    license.stopHeartbeat();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// 关闭应用
ipcMain.handle('quit-app', () => {
    app.quit();
});

// IPC handlers for file operations
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('select-file', async (event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filters
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('select-save-path', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: options.title || '保存文件',
        defaultPath: options.defaultPath,
        filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    return result.filePath || null;
});

ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('write-file', wrapAuth(async (event, filePath, content) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}));

ipcMain.handle('write-binary-file', wrapAuth(async (event, filePath, buffer) => {
    try {
        if (!filePath) {
            return { success: false, error: 'filePath为空' };
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        fs.writeFileSync(filePath, data);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}));

ipcMain.handle('file-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

ipcMain.handle('get-user-data-path', () => {
    // 返回安装目录，不使用C盘的userData
    return getAppRootPath();
});

ipcMain.handle('get-documents-path', () => {
    return app.getPath('documents');
});

// 获取应用根目录（项目目录）
ipcMain.handle('get-app-path', () => {
    return getAppRootPath();
});

// ==================== 采集 API ====================
const bloggerApi = require('./main/api');
const xingtuApi = require('./main/xingtuApi');

// 采集达人信息 - 基础框架，后续补充具体实现
ipcMain.handle('collect-blogger-info', wrapAuth(async (event, userId, cookies) => {
    return await bloggerApi.getBloggerInfo(userId, cookies);
}));

// 采集数据概览 - 基础框架
ipcMain.handle('collect-data-summary', wrapAuth(async (event, userId, cookies) => {
    return await bloggerApi.getDataSummary(userId, cookies);
}));

// 星图采集 - 采集单个博主数据
ipcMain.handle('collect-xingtu-blogger', wrapAuth(async (event, authorId, cookies, selectedFields) => {
    return await xingtuApi.collectBloggerData(authorId, cookies, selectedFields);
}));

// 星图采集 - 通过抖音主页URL搜索获取authorId
ipcMain.handle('search-author-by-douyin-url', wrapAuth(async (event, douyinUrl, cookies) => {
    return await xingtuApi.searchAuthorByDouyinUrl(douyinUrl, cookies);
}));

// HTTP 请求处理 - 用于验证账号（使用grade_info接口）
ipcMain.handle('check-account', wrapAuth(async (event, cookies) => {
    return new Promise((resolve) => {
        const options = {
            hostname: 'www.xingtu.cn',
            port: 443,
            path: '/gw/api/demander/grade_info',
            method: 'GET',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'agw-js-conv': 'str',
                'referer': 'https://www.xingtu.cn/ad/user-center/user/equities',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Host': 'www.xingtu.cn',
                'Connection': 'keep-alive',
                'x-login-source': '1'
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    
                    if (jsonData.base_resp && jsonData.base_resp.status_code === 0) {
                        resolve({
                            success: true,
                            message: '账号有效',
                            nickName: jsonData.name || '',
                            grade: jsonData.grade || 0
                        });
                    } else {
                        resolve({
                            success: false,
                            message: jsonData.base_resp?.status_message || '账号验证失败'
                        });
                    }
                } catch (e) {
                    resolve({
                        success: false,
                        message: `解析响应失败: ${e.message}`
                    });
                }
            });
        });

        req.on('error', (e) => {
            resolve({
                success: false,
                message: `请求失败: ${e.message}`
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                success: false,
                message: '请求超时'
            });
        });

        req.end();
    });
}));

// ==================== 达人列表功能 ====================

let bloggerWindow = null;
let capturedRequest = null;
let bloggerSessionCounter = 0;

// 打开达人广场浏览器窗口
ipcMain.handle('open-blogger-browser', wrapAuth(async (event, cookies) => {
    if (bloggerWindow && !bloggerWindow.isDestroyed()) {
        bloggerWindow.focus();
        return { success: true, message: '窗口已打开' };
    }
    
    // 每次创建全新的内存会话，不保存缓存
    bloggerSessionCounter++;
    const partition = `memory-blogger-${Date.now()}-${bloggerSessionCounter}`;
    const { session } = require('electron');
    const bloggerSession = session.fromPartition(partition, { cache: false });
    
    bloggerWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: partition
        },
        parent: mainWindow,
        title: '达人广场 - 星图平台'
    });
    
    // 设置 cookies
    const sessionObj = bloggerSession;
    const cookiePairs = cookies.split(';').map(c => c.trim()).filter(c => c);
    
    for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.split('=');
        const value = valueParts.join('=');
        if (name && value) {
            try {
                await sessionObj.cookies.set({
                    url: 'https://www.xingtu.cn',
                    name: name.trim(),
                    value: value.trim(),
                    domain: '.xingtu.cn'
                });
            } catch (e) {
                console.log('设置cookie失败:', name, e.message);
            }
        }
    }
    
    // 监听达人广场搜索接口
    capturedRequest = null;
    
    bloggerSession.webRequest.onBeforeRequest(
        { urls: ['https://www.xingtu.cn/gw/api/gsearch/search_for_author_square*'] },
        (details, callback) => {
            if (details.method === 'POST' && details.uploadData) {
                try {
                    const rawData = details.uploadData[0].bytes;
                    const bodyStr = rawData.toString('utf8');
                    capturedRequest = {
                        url: details.url,
                        body: JSON.parse(bodyStr)
                    };
                } catch (e) {
                    console.log('解析请求体失败:', e.message);
                }
            }
            callback({});
        }
    );
    
    bloggerSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://www.xingtu.cn/gw/api/gsearch/search_for_author_square*'] },
        (details, callback) => {
            if (details.method === 'POST' && capturedRequest) {
                capturedRequest.headers = details.requestHeaders;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('blogger-request-captured', true);
                }
            }
            callback({ requestHeaders: details.requestHeaders });
        }
    );
    
    // 加载星图达人广场页面 - TODO: 替换为实际URL
    bloggerWindow.loadURL('https://www.xingtu.cn/ad/creator/market');
    
    bloggerWindow.on('closed', () => {
        bloggerSession.clearStorageData();
        bloggerSession.clearCache();
        bloggerWindow = null;
    });
    
    return { success: true, message: '浏览器窗口已打开' };
}));

// 获取捕获的请求
ipcMain.handle('get-captured-request', wrapAuth(() => {
    return capturedRequest;
}, { unauthorizedReturn: null }));

// 使用捕获的请求参数获取达人列表
ipcMain.handle('fetch-blogger-list', wrapAuth(async (event, pageNum, capturedReq) => {
    return new Promise((resolve) => {
        try {
            // 修改分页参数
            const body = { ...capturedReq.body };
            body.page_param = { ...body.page_param, page: String(pageNum) };
            const bodyStr = JSON.stringify(body);
            
            const headers = { ...capturedReq.headers };
            delete headers['content-length'];
            delete headers['Content-Length'];
            delete headers['accept-encoding'];
            delete headers['Accept-Encoding'];
            
            const options = {
                hostname: 'www.xingtu.cn',
                path: '/gw/api/gsearch/search_for_author_square',
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(bodyStr)
                },
                timeout: 15000
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        // 根据星图实际返回结构处理
                        if (jsonData.authors && Array.isArray(jsonData.authors)) {
                            resolve({
                                success: true,
                                data: jsonData.authors,
                                total: jsonData.authors.length
                            });
                        } else if (jsonData.base_resp && jsonData.base_resp.status_code !== 0) {
                            resolve({
                                success: false,
                                message: jsonData.base_resp.status_message || '获取失败'
                            });
                        } else {
                            resolve({
                                success: true,
                                data: [],
                                total: 0
                            });
                        }
                    } catch (e) {
                        resolve({
                            success: false,
                            message: `解析响应失败: ${e.message}`
                        });
                    }
                });
            });
            
            req.on('error', (e) => {
                resolve({
                    success: false,
                    message: `请求失败: ${e.message}`
                });
            });
            
            req.on('timeout', () => {
                req.destroy();
                resolve({
                    success: false,
                    message: '请求超时'
                });
            });
            
            req.write(bodyStr);
            req.end();
        } catch (e) {
            resolve({
                success: false,
                message: `请求异常: ${e.message}`
            });
        }
    });
}));

// 关闭达人广场窗口
ipcMain.handle('close-blogger-browser', wrapAuth(() => {
    if (bloggerWindow && !bloggerWindow.isDestroyed()) {
        bloggerWindow.close();
        bloggerWindow = null;
    }
    capturedRequest = null;
    return { success: true };
}));

// ==================== 链接转换功能 ====================

// 解析抖音短链接获取抖音主页URL
ipcMain.handle('resolve-douyin-short-link', wrapAuth(async (event, shortUrl) => {
    return new Promise((resolve) => {
        try {
            console.log('[LinkConvert][Main] resolve-douyin-short-link start:', shortUrl);
            const { session } = require('electron');
            const partition = `resolve-link-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const resolveSession = session.fromPartition(partition, { cache: false });
            
            let foundUserUrl = null;
            let resolved = false; // 防止重复resolve
            let finishLoadTimer = null; // 记录did-finish-load的定时器
            
            // 完成处理的统一函数
            const finishResolve = (success, result) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                if (finishLoadTimer) clearTimeout(finishLoadTimer);
                if (!hiddenWindow.isDestroyed()) {
                    hiddenWindow.close();
                }
                if (success) {
                    console.log('[LinkConvert][Main] resolve success:', { shortUrl, userUrl: result });
                    resolve({ success: true, userUrl: result });
                } else {
                    console.log('[LinkConvert][Main] resolve failed:', { shortUrl, message: result });
                    resolve({ success: false, message: result });
                }
            };
            
            // 尝试从URL中提取用户ID
            const tryExtractUserUrl = (url) => {
                if (!url || foundUserUrl) return false;
                
                // 方式1: 从 www.douyin.com/user/ 提取
                const userMatch = url.match(/https:\/\/www\.douyin\.com\/user\/([A-Za-z0-9_-]+)/);
                if (userMatch) {
                    foundUserUrl = `https://www.douyin.com/user/${userMatch[1]}`;
                    console.log('[LinkConvert][Main] captured douyin user url:', foundUserUrl);
                    return true;
                }
                
                // 方式2: 兜底 - 从 www.iesdouyin.com/share/user/ 提取 sec_uid
                const iesMatch = url.match(/https:\/\/www\.iesdouyin\.com\/share\/user\/([A-Za-z0-9_-]+)/);
                if (iesMatch) {
                    foundUserUrl = `https://www.douyin.com/user/${iesMatch[1]}`;
                    console.log('[LinkConvert][Main] captured from iesdouyin:', foundUserUrl);
                    return true;
                }
                
                return false;
            };
            
            // 监听所有请求，查找抖音主页URL
            resolveSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
                if (tryExtractUserUrl(details.url) && !resolved) {
                    // 捕获到URL后立即完成，不等待页面加载
                    setTimeout(() => finishResolve(true, foundUserUrl), 100);
                }
                callback({});
            });
            
            // 创建隐藏窗口
            const hiddenWindow = new BrowserWindow({
                width: 800,
                height: 600,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    partition: partition
                }
            });

            // 额外拦截非 http/https 的跳转，避免触发系统外部协议弹窗
            try {
                hiddenWindow.webContents.setWindowOpenHandler(({ url }) => {
                    if (url && !/^https?:\/\//i.test(url)) {
                        console.log('[ProtocolBlock] blocked hidden window.open:', url);
                        return { action: 'deny' };
                    }
                    return { action: 'allow' };
                });

                hiddenWindow.webContents.on('will-navigate', (e, url) => {
                    if (url && !/^https?:\/\//i.test(url)) {
                        console.log('[ProtocolBlock] blocked hidden will-navigate:', url);
                        e.preventDefault();
                    }
                    // 兜底：尝试从导航URL中提取
                    if (tryExtractUserUrl(url) && !resolved) {
                        setTimeout(() => finishResolve(true, foundUserUrl), 100);
                    }
                });

                hiddenWindow.webContents.on('will-redirect', (e, url) => {
                    if (url && !/^https?:\/\//i.test(url)) {
                        console.log('[ProtocolBlock] blocked hidden will-redirect:', url);
                        e.preventDefault();
                        return;
                    }
                    // 增强兜底：从重定向URL中提取
                    console.log('[LinkConvert][Main] will-redirect:', url);
                    if (tryExtractUserUrl(url) && !resolved) {
                        setTimeout(() => finishResolve(true, foundUserUrl), 100);
                    }
                });

                // 增强兜底：监听did-redirect-navigation事件
                hiddenWindow.webContents.on('did-redirect-navigation', (e, url) => {
                    console.log('[LinkConvert][Main] did-redirect-navigation:', url);
                    if (tryExtractUserUrl(url) && !resolved) {
                        setTimeout(() => finishResolve(true, foundUserUrl), 100);
                    }
                });
            } catch (e) {
                console.log('[ProtocolBlock] hidden init failed:', e.message);
            }
            
            // 设置超时
            const timeout = setTimeout(() => {
                if (foundUserUrl) {
                    finishResolve(true, foundUserUrl);
                } else {
                    finishResolve(false, '请求超时');
                }
            }, 15000);
            
            // 页面加载完成后等待一下再检查结果
            hiddenWindow.webContents.on('did-finish-load', () => {
                if (resolved) return; // 已经处理过，跳过
                console.log('[LinkConvert][Main] did-finish-load:', shortUrl);
                // 清除之前的定时器（防止多次did-finish-load导致多个定时器）
                if (finishLoadTimer) clearTimeout(finishLoadTimer);
                finishLoadTimer = setTimeout(() => {
                    if (foundUserUrl) {
                        finishResolve(true, foundUserUrl);
                    } else {
                        finishResolve(false, '未找到抖音主页');
                    }
                }, 2000);
            });
            
            hiddenWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
                if (resolved) return;
                // 只处理主框架的加载失败
                if (!isMainFrame) return;
                console.log('[LinkConvert][Main] did-fail-load:', shortUrl, errorCode, errorDescription);
                if (foundUserUrl) {
                    finishResolve(true, foundUserUrl);
                } else {
                    finishResolve(false, '页面加载失败');
                }
            });
            
            console.log('[LinkConvert][Main] loadURL:', shortUrl);
            hiddenWindow.loadURL(shortUrl);
            
        } catch (e) {
            console.log('[LinkConvert][Main] resolve exception:', { shortUrl, message: e.message });
            resolve({ success: false, message: e.message });
        }
    });
}));

// 通过抖音主页获取星图作者ID
ipcMain.handle('search-xingtu-author', wrapAuth(async (event, douyinUrl, cookies) => {
    const xingtuApi = require('./main/xingtuApi');
    return await xingtuApi.searchAuthorByDouyinUrl(douyinUrl, cookies);
}));

// ==================== 登录功能 ====================

let loginWindow = null;
let loginSessionCounter = 0;

// 获取星图账号信息（昵称和等级）
const getXingtuAccountInfo = (cookies) => {
    return new Promise((resolve) => {
        const options = {
            hostname: 'www.xingtu.cn',
            port: 443,
            path: '/gw/api/demander/grade_info',
            method: 'GET',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'agw-js-conv': 'str',
                'referer': 'https://www.xingtu.cn/ad/user-center/user/equities',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Host': 'www.xingtu.cn',
                'Connection': 'keep-alive',
                'x-login-source': '1'
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.base_resp && jsonData.base_resp.status_code === 0) {
                        resolve({
                            success: true,
                            nickName: jsonData.name || '',
                            grade: jsonData.grade || 0
                        });
                    } else {
                        resolve({ success: false });
                    }
                } catch (e) {
                    resolve({ success: false });
                }
            });
        });

        req.on('error', () => resolve({ success: false }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
        req.end();
    });
};

// 星图登录 - 打开星图网页并监听grade_info接口的Cookies
ipcMain.handle('open-xingtu-login', async () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
        loginWindow = null;
    }
    
    loginSessionCounter++;
    const partition = `memory-login-${Date.now()}-${loginSessionCounter}`;
    const { session } = require('electron');
    const loginSession = session.fromPartition(partition, { cache: false });
    
    loginSession.clearStorageData();
    loginSession.clearCache();
    
    loginWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: partition
        },
        parent: mainWindow,
        title: '星图平台 - 登录获取Cookies'
    });
    
    let cookiesCaptured = false;
    
    // 监听grade_info接口，捕获Cookie头
    loginSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://www.xingtu.cn/gw/api/demander/grade_info*'] },
        async (details, callback) => {
            if (!cookiesCaptured && details.requestHeaders) {
                const cookieHeader = details.requestHeaders['Cookie'] || details.requestHeaders['cookie'];
                if (cookieHeader) {
                    cookiesCaptured = true;
                    
                    // 请求接口获取昵称和等级
                    const accountInfo = await getXingtuAccountInfo(cookieHeader);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('xingtu-login-captured', {
                            cookies: cookieHeader,
                            nickName: accountInfo.nickName || '',
                            grade: accountInfo.grade || 0
                        });
                    }
                    
                    setTimeout(() => {
                        if (loginWindow && !loginWindow.isDestroyed()) {
                            loginWindow.close();
                            loginWindow = null;
                        }
                    }, 500);
                }
            }
            callback({ requestHeaders: details.requestHeaders });
        }
    );
    
    loginWindow.on('closed', () => {
        loginSession.clearStorageData();
        loginSession.clearCache();
        loginWindow = null;
    });
    
    // 加载星图首页
    loginWindow.loadURL('https://www.xingtu.cn/');
    
    return { success: true, message: '星图登录窗口已打开，请登录后访问个人中心' };
});

// 方舟登录 - 打开方舟网页
let fangzhouChildWindows = [];

ipcMain.handle('open-fangzhou-login', async () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
        loginWindow = null;
    }
    
    // 关闭所有子窗口
    fangzhouChildWindows.forEach(win => {
        if (win && !win.isDestroyed()) {
            win.close();
        }
    });
    fangzhouChildWindows = [];
    
    loginSessionCounter++;
    const partition = `memory-login-${Date.now()}-${loginSessionCounter}`;
    const { session } = require('electron');
    const loginSession = session.fromPartition(partition, { cache: false });
    
    loginSession.clearStorageData();
    loginSession.clearCache();
    
    const capturedCookies = new Set();
    let lastCaptureAt = 0;
    
    // 监听grade_info接口（子账号进入星图后会触发）
    loginSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://www.xingtu.cn/gw/api/demander/grade_info*'] },
        async (details, callback) => {
            try {
                if (details.requestHeaders) {
                    const cookieHeader = details.requestHeaders['Cookie'] || details.requestHeaders['cookie'];
                    if (cookieHeader) {
                        const now = Date.now();
                        // 防止同一账号进入页面时短时间内多次触发
                        if (now - lastCaptureAt < 600) {
                            callback({ requestHeaders: details.requestHeaders });
                            return;
                        }

                        if (!capturedCookies.has(cookieHeader)) {
                            lastCaptureAt = now;
                            capturedCookies.add(cookieHeader);

                            // 请求接口获取昵称和等级
                            const accountInfo = await getXingtuAccountInfo(cookieHeader);

                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('xingtu-login-captured', {
                                    cookies: cookieHeader,
                                    nickName: accountInfo.nickName || '',
                                    grade: accountInfo.grade || 0
                                });
                            }

                            // 不自动关闭窗口：支持继续点击其它子账号并多次添加
                            console.log('[FangzhouLogin] captured cookies for sub-account:', accountInfo.nickName || 'unknown');
                        }
                    }
                }
            } catch (e) {
                console.log('[FangzhouLogin] capture failed:', e.message);
            }
            callback({ requestHeaders: details.requestHeaders });
        }
    );
    
    // 创建子窗口的函数（共享session，支持监听）
    const createChildWindow = (url) => {
        const childWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: partition
            },
            parent: mainWindow,
            title: '方舟平台 - 子账号'
        });
        
        // 子窗口也需要处理新窗口请求
        childWindow.webContents.setWindowOpenHandler(({ url }) => {
            createChildWindow(url);
            return { action: 'deny' };
        });
        
        childWindow.on('closed', () => {
            const index = fangzhouChildWindows.indexOf(childWindow);
            if (index > -1) {
                fangzhouChildWindows.splice(index, 1);
            }
        });
        
        fangzhouChildWindows.push(childWindow);
        childWindow.loadURL(url);
        return childWindow;
    };
    
    loginWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: partition
        },
        parent: mainWindow,
        title: '方舟平台 - 登录'
    });
    
    // 处理新窗口请求（点击子账号时弹出的窗口）
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        createChildWindow(url);
        return { action: 'deny' };
    });
    
    loginWindow.on('closed', () => {
        // 关闭所有子窗口
        fangzhouChildWindows.forEach(win => {
            if (win && !win.isDestroyed()) {
                win.close();
            }
        });
        fangzhouChildWindows = [];
        loginSession.clearStorageData();
        loginSession.clearCache();
        loginWindow = null;
    });
    
    // 加载方舟登录页面
    loginWindow.loadURL('https://agent.oceanengine.com/login');
    
    return { success: true, message: '方舟登录窗口已打开，登录后点击子账号进入' };
});

// 关闭登录窗口
ipcMain.handle('close-login-window', () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
        loginWindow = null;
    }
    return { success: true };
});

// 打开达人详情页
let detailSessionCounter = 0;
ipcMain.handle('open-blogger-detail', wrapAuth(async (event, url, cookies) => {
    detailSessionCounter++;
    const partition = `memory-detail-${Date.now()}-${detailSessionCounter}`;
    const { session } = require('electron');
    const detailSession = session.fromPartition(partition, { cache: false });
    
    const detailWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: partition
        },
        parent: mainWindow,
        title: '达人详情'
    });
    
    const cookiePairs = cookies.split(';').map(c => c.trim()).filter(c => c);
    
    for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.split('=');
        const value = valueParts.join('=');
        if (name && value) {
            try {
                await detailSession.cookies.set({
                    url: 'https://www.xingtu.cn',
                    name: name.trim(),
                    value: value.trim(),
                    domain: '.xingtu.cn'
                });
            } catch (e) {
                console.log('设置cookie失败:', name, e.message);
            }
        }
    }
    
    detailWindow.on('closed', () => {
        detailSession.clearStorageData();
        detailSession.clearCache();
    });
    
    detailWindow.loadURL(url);
    return { success: true };
}));

// ==================== 激活码验证 API ====================

// 获取机器码
ipcMain.handle('get-machine-code', () => {
    return license.generateMachineCode();
});

// 检查激活状态
ipcMain.handle('check-license', async () => {
    const info = license.getLicenseInfo();
    if (info && info.days_remaining > 0) {
        return { success: true, data: info };
    }
    return { success: false };
});

// 激活激活码 (force=true 时强制解绑原设备)
ipcMain.handle('activate-license', async (event, licenseKey, force = false) => {
    return await license.activate(licenseKey, force);
});

// 显示确认对话框
ipcMain.handle('show-confirm-dialog', async (event, options) => {
    const result = await dialog.showMessageBox({
        type: 'question',
        title: options.title || '确认',
        message: options.message || '',
        buttons: options.buttons || ['取消', '确定'],
        defaultId: 1,
        cancelId: 0
    });
    return result.response === 1;
});

// 解绑授权码
ipcMain.handle('unbind-license', async () => {
    return await license.unbindLocal();
});

// 验证激活状态
ipcMain.handle('verify-license', async () => {
    return await license.verify();
});

// 获取激活信息
ipcMain.handle('get-license-info', () => {
    return license.getLicenseInfo();
});

// 检查是否为SVIP
ipcMain.handle('is-svip', () => {
    return license.isSVIP();
});

// 进入主程序 (从激活窗口)
ipcMain.handle('enter-main-app', async () => {
    const auth = await ensureAuthorized();
    if (auth.success) {
        license.startHeartbeat((expiredResult) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '授权提醒',
                    message: expiredResult.message || '您的授权已失效',
                    buttons: ['确定']
                }).then(() => {
                    isAuthorized = false;
                    lastAuthAt = 0;
                    license.stopHeartbeat();
                    mainWindow.close();
                    createActivationWindow();
                });
            }
        });

        isAuthorized = true;
        lastAuthAt = Date.now();
        
        if (activationWindow && !activationWindow.isDestroyed()) {
            activationWindow.close();
        }
        createWindow();
        return { success: true };
    }
    return { success: false, message: auth.message || '验证失败' };
});
