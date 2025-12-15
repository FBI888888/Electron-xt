const { app, BrowserWindow, ipcMain, dialog, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// 激活码验证模块
const license = require('./main/license');

let mainWindow;
let activationWindow;

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

    const iconPath = process.platform === 'win32' ? path.join(getAppRootPath(), 'logo.ico') : undefined;
    
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
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'default',
        show: false,
        autoHideMenuBar: true,
        icon: iconPath
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

    const iconPath = process.platform === 'win32' ? path.join(getAppRootPath(), 'logo.ico') : undefined;
    
    activationWindow = new BrowserWindow({
        width: 520,
        height: 700,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'default',
        show: false,
        autoHideMenuBar: true,
        icon: iconPath
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
    // 设置激活数据存储路径
    license.setDataPath(app.getPath('userData'));
    
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
                    license.stopHeartbeat();
                    mainWindow.close();
                    createActivationWindow();
                });
            }
        });
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

ipcMain.handle('write-file', async (event, filePath, content) => {
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
});

ipcMain.handle('file-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
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
ipcMain.handle('collect-blogger-info', async (event, userId, cookies) => {
    return await bloggerApi.getBloggerInfo(userId, cookies);
});

// 采集数据概览 - 基础框架
ipcMain.handle('collect-data-summary', async (event, userId, cookies) => {
    return await bloggerApi.getDataSummary(userId, cookies);
});

// 星图采集 - 采集单个博主数据
ipcMain.handle('collect-xingtu-blogger', async (event, authorId, cookies, selectedFields) => {
    return await xingtuApi.collectBloggerData(authorId, cookies, selectedFields);
});

// 星图采集 - 通过抖音主页URL搜索获取authorId
ipcMain.handle('search-author-by-douyin-url', async (event, douyinUrl, cookies) => {
    return await xingtuApi.searchAuthorByDouyinUrl(douyinUrl, cookies);
});

// HTTP 请求处理 - 用于验证账号（使用grade_info接口）
ipcMain.handle('check-account', async (event, cookies) => {
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
});

// ==================== 达人列表功能 ====================

let bloggerWindow = null;
let capturedRequest = null;
let bloggerSessionCounter = 0;

// 打开达人广场浏览器窗口
ipcMain.handle('open-blogger-browser', async (event, cookies) => {
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
});

// 获取捕获的请求
ipcMain.handle('get-captured-request', () => {
    return capturedRequest;
});

// 使用捕获的请求参数获取达人列表
ipcMain.handle('fetch-blogger-list', async (event, pageNum, capturedReq) => {
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
});

// 关闭达人广场窗口
ipcMain.handle('close-blogger-browser', () => {
    if (bloggerWindow && !bloggerWindow.isDestroyed()) {
        bloggerWindow.close();
        bloggerWindow = null;
    }
    capturedRequest = null;
    return { success: true };
});

// ==================== 链接转换功能 ====================

// 解析抖音短链接获取抖音主页URL
ipcMain.handle('resolve-douyin-short-link', async (event, shortUrl) => {
    return new Promise((resolve) => {
        try {
            console.log('[LinkConvert][Main] resolve-douyin-short-link start:', shortUrl);
            const { session } = require('electron');
            const partition = `resolve-link-${Date.now()}`;
            const resolveSession = session.fromPartition(partition, { cache: false });
            
            let foundUserUrl = null;
            
            // 监听所有请求，查找抖音主页URL
            resolveSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
                const url = details.url;
                // 匹配抖音主页URL格式
                const userMatch = url.match(/https:\/\/www\.douyin\.com\/user\/([A-Za-z0-9_-]+)/);
                if (userMatch && !foundUserUrl) {
                    foundUserUrl = `https://www.douyin.com/user/${userMatch[1]}`;
                    console.log('[LinkConvert][Main] captured douyin user url:', foundUserUrl);
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
                });

                hiddenWindow.webContents.on('will-redirect', (e, url) => {
                    if (url && !/^https?:\/\//i.test(url)) {
                        console.log('[ProtocolBlock] blocked hidden will-redirect:', url);
                        e.preventDefault();
                    }
                });
            } catch (e) {
                console.log('[ProtocolBlock] hidden init failed:', e.message);
            }
            
            // 设置超时
            const timeout = setTimeout(() => {
                if (!hiddenWindow.isDestroyed()) {
                    hiddenWindow.close();
                }
                console.log('[LinkConvert][Main] resolve timeout:', shortUrl);
                resolve({ success: false, message: '请求超时' });
            }, 15000);
            
            // 页面加载完成后等待一下再检查结果
            hiddenWindow.webContents.on('did-finish-load', () => {
                console.log('[LinkConvert][Main] did-finish-load:', shortUrl);
                setTimeout(() => {
                    clearTimeout(timeout);
                    if (!hiddenWindow.isDestroyed()) {
                        hiddenWindow.close();
                    }
                    if (foundUserUrl) {
                        console.log('[LinkConvert][Main] resolve success:', { shortUrl, userUrl: foundUserUrl });
                        resolve({ success: true, userUrl: foundUserUrl });
                    } else {
                        console.log('[LinkConvert][Main] resolve failed (no user url):', shortUrl);
                        resolve({ success: false, message: '未找到抖音主页' });
                    }
                }, 2000);
            });
            
            hiddenWindow.webContents.on('did-fail-load', () => {
                clearTimeout(timeout);
                if (!hiddenWindow.isDestroyed()) {
                    hiddenWindow.close();
                }
                console.log('[LinkConvert][Main] did-fail-load:', shortUrl);
                if (foundUserUrl) {
                    console.log('[LinkConvert][Main] resolve success after fail-load:', { shortUrl, userUrl: foundUserUrl });
                    resolve({ success: true, userUrl: foundUserUrl });
                } else {
                    console.log('[LinkConvert][Main] resolve failed after fail-load:', shortUrl);
                    resolve({ success: false, message: '页面加载失败' });
                }
            });
            
            console.log('[LinkConvert][Main] loadURL:', shortUrl);
            hiddenWindow.loadURL(shortUrl);
            
        } catch (e) {
            console.log('[LinkConvert][Main] resolve exception:', { shortUrl, message: e.message });
            resolve({ success: false, message: e.message });
        }
    });
});

// 通过抖音主页获取星图作者ID
ipcMain.handle('search-xingtu-author', async (event, douyinUrl, cookies) => {
    const xingtuApi = require('./main/xingtuApi');
    return await xingtuApi.searchAuthorByDouyinUrl(douyinUrl, cookies);
});

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
ipcMain.handle('open-blogger-detail', async (event, url, cookies) => {
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
});

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
    const result = await license.verify();
    if (result.success) {
        license.startHeartbeat((expiredResult) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '授权提醒',
                    message: expiredResult.message || '您的授权已失效',
                    buttons: ['确定']
                }).then(() => {
                    license.stopHeartbeat();
                    mainWindow.close();
                    createActivationWindow();
                });
            }
        });
        
        if (activationWindow && !activationWindow.isDestroyed()) {
            activationWindow.close();
        }
        createWindow();
        return { success: true };
    }
    return { success: false, message: '验证失败' };
});
