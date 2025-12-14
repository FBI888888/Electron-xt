const { ipcRenderer } = require('electron');
const path = require('path');

// 数据存储路径
const DATA_DIR = 'data';
const ACCOUNTS_FILE = 'xingtu_accounts.json';
const SETTINGS_FILE = 'collect_settings.json';

// 全局状态
let accounts = [];
let collectItems = [];
let settings = null;
let isCollecting = false;
let appPath = '';
let currentMemberLevel = null;

// 高级功能权限配置 (VIP无法访问的页面)
const PREMIUM_PAGES = ['blogger-list'];

// ==================== 工具函数 ====================

function formatFansCount(count) {
    const num = parseInt(count, 10);
    if (isNaN(num) || num < 10000) return count;
    return (num / 10000).toFixed(1) + 'w';
}

// Toast 消息提示
function showToast(type, title, message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };
    
    toast.innerHTML = `
        ${icons[type]}
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// 模态框
function showModal(title, content, buttons = [], getFormData = null) {
    return new Promise((resolve) => {
        const container = document.getElementById('modal-container');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const buttonsHtml = buttons.map((btn, index) => 
            `<button class="btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}" data-index="${index}">${btn.text}</button>`
        ).join('');
        
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">${title}</div>
                <div class="modal-body">${content}</div>
                <div class="modal-footer">${buttonsHtml}</div>
            </div>
        `;
        
        container.appendChild(overlay);
        
        overlay.querySelectorAll('.modal-footer .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const buttonValue = buttons[index].value;
                
                let formData = null;
                if (getFormData && buttonValue) {
                    formData = getFormData();
                }
                
                overlay.remove();
                
                if (formData !== null) {
                    resolve({ confirmed: buttonValue, data: formData });
                } else {
                    resolve(buttonValue);
                }
            });
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

// 确认对话框
async function showConfirm(title, message) {
    return showModal(title, `<p>${message}</p>`, [
        { text: '取消', value: false },
        { text: '确定', value: true, primary: true }
    ]);
}

// 初始化应用路径
async function initAppPath() {
    if (!appPath) {
        appPath = await ipcRenderer.invoke('get-app-path');
    }
    return appPath;
}

// 文件路径助手
async function getDataPath(filename) {
    await initAppPath();
    return path.join(appPath, DATA_DIR, filename);
}

// 加载 JSON 数据
async function loadJsonData(filename, defaultValue = null) {
    try {
        const filePath = await getDataPath(filename);
        const exists = await ipcRenderer.invoke('file-exists', filePath);
        if (!exists) return defaultValue;
        
        const result = await ipcRenderer.invoke('read-file', filePath);
        if (result.success) {
            return JSON.parse(result.content);
        }
    } catch (err) {
        console.error('加载数据失败:', err);
    }
    return defaultValue;
}

// 保存 JSON 数据
async function saveJsonData(filename, data) {
    try {
        const filePath = await getDataPath(filename);
        const result = await ipcRenderer.invoke('write-file', filePath, JSON.stringify(data, null, 2));
        return result.success;
    } catch (err) {
        console.error('保存数据失败:', err);
        return false;
    }
}

// ==================== 页面导航 ====================

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageName = item.dataset.page;
            
            // 检查高级功能权限
            if (PREMIUM_PAGES.includes(pageName) && !hasPremiumAccess()) {
                showPermissionDenied();
                return;
            }
            
            // 更新导航状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 切换页面
            pages.forEach(page => {
                page.classList.remove('active');
                if (page.id === `page-${pageName}`) {
                    page.classList.add('active');
                }
            });
            
            // 切换到授权信息页面时刷新数据
            if (pageName === 'license') {
                loadLicenseInfo();
            }
        });
    });
}

// 检查是否有高级功能访问权限 (VVIP或SVIP)
function hasPremiumAccess() {
    return currentMemberLevel === 'VVIP' || currentMemberLevel === 'SVIP';
}

// 显示权限不足提示
function showPermissionDenied() {
    showModal('权限不足', `
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;">🔒</div>
            <p style="font-size: 16px; color: #333; margin-bottom: 15px;">
                此功能为<span style="color: #7c3aed; font-weight: 600;">高级会员</span>和<span style="color: #db2777; font-weight: 600;">超级会员</span>专属功能
            </p>
            <p style="font-size: 14px; color: #666;">
                如需使用请联系管理员提升权限
            </p>
        </div>
    `, [
        { text: '我知道了', value: true, primary: true }
    ]);
}

// ==================== 账号管理页面 ====================

async function loadAccounts() {
    accounts = await loadJsonData(ACCOUNTS_FILE, []);
    renderAccountTable();
}

function renderAccountTable() {
    const tbody = document.getElementById('account-tbody');
    
    if (accounts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #999;">
                    暂无账号数据，请添加账号
                </td>
            </tr>
        `;
        return;
    }
    
    // 根据等级获取最大采集次数
    const getMaxCollectCount = (grade) => {
        const counts = { 1: 5, 2: 500, 3: 500, 4: 800, 5: 800, 6: 800, 7: 800 };
        return counts[grade] || 0;
    };
    
    tbody.innerHTML = accounts.map((account, index) => {
        const grade = account.grade || 0;
        const gradeDisplay = grade > 0 ? `Lv${grade}` : '';
        const maxCollect = grade > 0 ? getMaxCollectCount(grade) : '';
        
        const collectedCount = account.collectedCount || 0;
        
        return `
        <tr data-index="${index}">
            <td>${account.remark || ''}</td>
            <td>${account.nickName || ''}</td>
            <td>${gradeDisplay}</td>
            <td>${maxCollect}</td>
            <td>${collectedCount}</td>
            <td>
                <span class="status-tag ${account.status === '正常' ? 'normal' : account.status === '失效' ? 'error' : 'pending'}">
                    ${account.status || '未检查'}
                </span>
            </td>
            <td title="${account.cookies || ''}">${account.cookies || ''}</td>
        </tr>
    `;
    }).join('');
    
    // 绑定右键菜单
    tbody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const index = parseInt(row.dataset.index);
            showAccountContextMenu(e.clientX, e.clientY, index);
        });
    });
}

function showAccountContextMenu(x, y, index) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="check">检查账号</div>
        <div class="context-menu-item" data-action="edit">修改账号</div>
        <div class="context-menu-item" data-action="delete">删除账号</div>
    `;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.remove();
            
            switch (action) {
                case 'check':
                    checkSingleAccount(index);
                    break;
                case 'edit':
                    editAccount(index);
                    break;
                case 'delete':
                    deleteAccount(index);
                    break;
            }
        });
    });
    
    setTimeout(() => {
        document.addEventListener('click', function handler() {
            menu.remove();
            document.removeEventListener('click', handler);
        });
    }, 0);
}

async function checkAccountStatus(cookies) {
    try {
        const result = await ipcRenderer.invoke('check-account', cookies);
        return result;
    } catch (err) {
        return { success: false, message: `请求失败: ${err.message}` };
    }
}

async function addAccount() {
    const remarkInput = document.getElementById('remark-input');
    const cookiesInput = document.getElementById('cookies-input');
    
    const remark = remarkInput.value.trim();
    const cookies = cookiesInput.value.trim();
    
    if (!remark) {
        showToast('warning', '提示', '请输入备注名');
        return;
    }
    
    if (!cookies) {
        showToast('warning', '提示', '请输入Cookies');
        return;
    }
    
    showToast('info', '验证中', '正在验证账号...');
    
    const result = await checkAccountStatus(cookies);
    
    if (result.success) {
        accounts.push({
            remark,
            nickName: result.nickName,
            status: '正常',
            cookies
        });
        
        await saveJsonData(ACCOUNTS_FILE, accounts);
        renderAccountTable();
        
        remarkInput.value = '';
        cookiesInput.value = '';
        
        showToast('success', '成功', '账号添加成功');
    } else {
        showToast('error', '验证失败', result.message);
    }
}

async function checkAllAccounts() {
    if (accounts.length === 0) {
        showToast('warning', '提示', '没有账号需要检查');
        return;
    }
    
    showToast('info', '检查中', `正在检查 ${accounts.length} 个账号...`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < accounts.length; i++) {
        const result = await checkAccountStatus(accounts[i].cookies);
        
        accounts[i].status = result.success ? '正常' : '失效';
        if (result.success) {
            if (result.nickName) accounts[i].nickName = result.nickName;
            if (result.grade) accounts[i].grade = result.grade;
        }
        
        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }
        
        renderAccountTable();
    }
    
    await saveJsonData(ACCOUNTS_FILE, accounts);
    
    if (failCount === 0) {
        showToast('success', '检查完成', `全部 ${accounts.length} 个账号验证成功！`);
    } else {
        showToast('warning', '检查完成', `成功: ${successCount} 个 | 失败: ${failCount} 个`);
    }
}

async function checkSingleAccount(index) {
    const account = accounts[index];
    showToast('info', '检查中', `正在检查账号: ${account.remark}`);
    
    const result = await checkAccountStatus(account.cookies);
    
    accounts[index].status = result.success ? '正常' : '失效';
    if (result.success) {
        if (result.nickName) accounts[index].nickName = result.nickName;
        if (result.grade) accounts[index].grade = result.grade;
    }
    
    await saveJsonData(ACCOUNTS_FILE, accounts);
    renderAccountTable();
    
    if (result.success) {
        showToast('success', '检查成功', `账号 "${account.remark}" 状态正常`);
    } else {
        showToast('error', '检查失败', `账号 "${account.remark}" ${result.message}`);
    }
}

async function editAccount(index) {
    const account = accounts[index];
    
    const content = `
        <div class="form-row">
            <label class="form-label">备注名:</label>
            <input type="text" class="input" id="edit-remark" value="${account.remark || ''}" style="flex: 1;">
        </div>
        <div class="form-row">
            <label class="form-label">Cookies:</label>
            <input type="text" class="input" id="edit-cookies" value="${account.cookies || ''}" style="flex: 1;">
        </div>
    `;
    
    const result = await showModal('修改账号', content, [
        { text: '取消', value: false },
        { text: '保存', value: true, primary: true }
    ], () => {
        return {
            remark: document.getElementById('edit-remark')?.value.trim() || '',
            cookies: document.getElementById('edit-cookies')?.value.trim() || ''
        };
    });
    
    if (result && result.confirmed && result.data) {
        const { remark: newRemark, cookies: newCookies } = result.data;
        
        if (!newRemark) {
            showToast('warning', '提示', '请输入备注名');
            return;
        }
        
        if (!newCookies) {
            showToast('warning', '提示', '请输入Cookies');
            return;
        }
        
        const oldCookies = accounts[index].cookies;
        accounts[index].remark = newRemark;
        accounts[index].cookies = newCookies;
        
        if (oldCookies !== newCookies) {
            showToast('info', '验证中', '正在验证新的Cookies...');
            const checkResult = await checkAccountStatus(newCookies);
            
            accounts[index].status = checkResult.success ? '正常' : '失效';
            if (checkResult.success && checkResult.nickName) {
                accounts[index].nickName = checkResult.nickName;
            }
            
            if (checkResult.success) {
                showToast('success', '修改成功', '账号信息已更新并验证通过');
            } else {
                showToast('warning', '验证失败', `账号信息已更新，但验证失败: ${checkResult.message}`);
            }
        } else {
            showToast('success', '修改成功', '账号信息已更新');
        }
        
        await saveJsonData(ACCOUNTS_FILE, accounts);
        renderAccountTable();
    }
}

async function deleteAccount(index) {
    const account = accounts[index];
    const confirmed = await showConfirm('确认删除', `确定要删除账号 "${account.remark}" 吗？`);
    
    if (confirmed) {
        accounts.splice(index, 1);
        await saveJsonData(ACCOUNTS_FILE, accounts);
        renderAccountTable();
        showToast('success', '删除成功', '账号已删除');
    }
}

// 星图登录
async function xingtuLogin() {
    showToast('info', '正在打开', '正在打开星图登录窗口，请登录后访问个人中心...');
    const result = await ipcRenderer.invoke('open-xingtu-login');
    if (!result.success) {
        showToast('error', '打开失败', result.message);
    }
}

// 方舟登录
async function fangzhouLogin() {
    showToast('info', '正在打开', '正在打开方舟登录窗口...');
    const result = await ipcRenderer.invoke('open-fangzhou-login');
    if (!result.success) {
        showToast('error', '打开失败', result.message);
    }
}

// 监听星图登录Cookies捕获事件
ipcRenderer.on('xingtu-login-captured', async (event, data) => {
    const cookiesInput = document.getElementById('cookies-input');
    const remarkInput = document.getElementById('remark-input');
    
    if (cookiesInput) {
        cookiesInput.value = data.cookies;
    }
    
    // 自动添加账号
    if (data.nickName) {
        // 使用昵称作为备注名
        if (remarkInput && !remarkInput.value.trim()) {
            remarkInput.value = data.nickName;
        }
        
        accounts.push({
            remark: remarkInput.value.trim() || data.nickName,
            nickName: data.nickName,
            grade: data.grade || 0,
            status: '正常',
            cookies: data.cookies
        });
        
        await saveJsonData(ACCOUNTS_FILE, accounts);
        renderAccountTable();
        
        remarkInput.value = '';
        cookiesInput.value = '';
        
        const gradeDisplay = data.grade > 0 ? `Lv${data.grade}` : '未知';
        showToast('success', '登录成功', `账号 "${data.nickName}" 已添加，等级: ${gradeDisplay}`);
    } else {
        showToast('success', '获取成功', 'Cookies已自动填入，请输入备注名后点击"添加账号"');
    }
});

function initAccountPage() {
    document.getElementById('add-account-btn').addEventListener('click', addAccount);
    document.getElementById('xingtu-login-btn').addEventListener('click', xingtuLogin);
    document.getElementById('fangzhou-login-btn').addEventListener('click', fangzhouLogin);
    document.getElementById('check-all-btn').addEventListener('click', checkAllAccounts);
    loadAccounts();
}

// ==================== 采集设置页面 ====================

function getDefaultSettings() {
    return {
        save_mode: 'local',
        local: {
            filename: 'collected_data.xlsx',
            path: ''
        },
        collect_fields: [
            'spread-info',
            'effect-estimate',
            'seed-value',
            'convert-ability',
            'ecom-stat',
            'latest-videos',
            'content-type',
            'hot-words',
            'playlet-theme',
            'contract-info',
            'link-user',
            'audience-profile'
        ],
        account_mode: 'multi' // 'multi' = 多账户轮询, 'single' = 单账号采集
    };
}

async function loadSettings() {
    const defaultSettings = getDefaultSettings();
    
    const documentsPath = await ipcRenderer.invoke('get-documents-path');
    defaultSettings.local.path = documentsPath;
    
    settings = await loadJsonData(SETTINGS_FILE, null);
    
    if (settings) {
        if (settings.local) {
            defaultSettings.local.filename = settings.local.filename || defaultSettings.local.filename;
            defaultSettings.local.path = settings.local.path || defaultSettings.local.path;
        }
        if (settings.collect_fields) {
            defaultSettings.collect_fields = settings.collect_fields;
        }
        if (settings.account_mode) {
            defaultSettings.account_mode = settings.account_mode;
        }
    }
    
    settings = defaultSettings;
    renderSettings();
}

function renderSettings() {
    document.getElementById('filename-input').value = settings.local?.filename || '';
    document.getElementById('path-input').value = settings.local?.path || '';
    
    const selectedFields = settings.collect_fields || [];
    document.querySelectorAll('input[name="collect-field"]').forEach(checkbox => {
        checkbox.checked = selectedFields.includes(checkbox.value);
    });
    
    // 设置账号模式
    const accountMode = settings.account_mode || 'multi';
    document.querySelectorAll('input[name="account-mode"]').forEach(radio => {
        radio.checked = radio.value === accountMode;
    });
    
    // 显示/隐藏单账号选择并设置值
    toggleSingleAccountSelect();
    if (settings.single_account_cookies) {
        document.getElementById('single-account-select').value = settings.single_account_cookies;
    }
}

async function saveSettings(showNotification = false) {
    const filename = document.getElementById('filename-input').value.trim();
    const savePath = document.getElementById('path-input').value.trim();
    
    const selectedFields = [];
    document.querySelectorAll('input[name="collect-field"]:checked').forEach(checkbox => {
        selectedFields.push(checkbox.value);
    });
    
    // 获取账号模式
    const accountModeRadio = document.querySelector('input[name="account-mode"]:checked');
    const accountMode = accountModeRadio ? accountModeRadio.value : 'multi';
    
    // 获取单账号选择
    const singleAccountCookies = document.getElementById('single-account-select').value;
    
    settings = {
        save_mode: 'local',
        local: {
            filename,
            path: savePath
        },
        collect_fields: selectedFields,
        account_mode: accountMode,
        single_account_cookies: singleAccountCookies
    };
    
    await saveJsonData(SETTINGS_FILE, settings);
}

async function selectSavePath() {
    const selectedPath = await ipcRenderer.invoke('select-directory');
    if (selectedPath) {
        document.getElementById('path-input').value = selectedPath;
    }
}

function selectAllFields() {
    document.querySelectorAll('input[name="collect-field"]').forEach(checkbox => {
        checkbox.checked = true;
    });
}

function deselectAllFields() {
    document.querySelectorAll('input[name="collect-field"]').forEach(checkbox => {
        checkbox.checked = false;
    });
}

function initSettingsPage() {
    document.getElementById('select-path-btn').addEventListener('click', async () => {
        await selectSavePath();
        saveSettings();
    });
    document.getElementById('select-all-btn').addEventListener('click', () => {
        selectAllFields();
        saveSettings();
    });
    document.getElementById('deselect-all-btn').addEventListener('click', () => {
        deselectAllFields();
        saveSettings();
    });
    
    document.getElementById('filename-input').addEventListener('input', saveSettings);
    
    document.querySelectorAll('input[name="collect-field"]').forEach(checkbox => {
        checkbox.addEventListener('change', saveSettings);
    });
    
    // 账号模式变更时保存设置并切换显示
    document.querySelectorAll('input[name="account-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            toggleSingleAccountSelect();
            saveSettings();
        });
    });
    
    // 单账号选择变更时保存设置
    document.getElementById('single-account-select').addEventListener('change', saveSettings);
    
    loadSettings();
}

// 切换单账号选择框显示状态
function toggleSingleAccountSelect() {
    const singleAccountRow = document.getElementById('single-account-row');
    const isSingleMode = document.querySelector('input[name="account-mode"]:checked')?.value === 'single';
    singleAccountRow.style.display = isSingleMode ? 'flex' : 'none';
    
    if (isSingleMode) {
        populateSingleAccountSelect();
    }
}

// 填充单账号选择下拉框
function populateSingleAccountSelect() {
    const select = document.getElementById('single-account-select');
    const currentValue = select.value;
    
    // 清空现有选项
    select.innerHTML = '<option value="">-- 请选择账号 --</option>';
    
    // 添加可用账号
    accounts.filter(a => a.status === '正常').forEach(account => {
        const option = document.createElement('option');
        option.value = account.cookies;
        option.textContent = account.remark || account.nickName || '未命名账号';
        select.appendChild(option);
    });
    
    // 恢复之前选中的值
    if (currentValue) {
        select.value = currentValue;
    }
}

// ==================== 采集管理页面 ====================

// 判断URL类型
function getUrlType(url) {
    if (url.includes('xingtu.cn')) return 'xingtu';
    if (url.includes('douyin.com/user')) return 'douyin';
    return null;
}

// 从星图URL提取authorId
function extractAuthorIdFromXingtu(url) {
    // 匹配星图URL: https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/7099830415812198437
    const pattern = /xingtu\.cn\/.*?\/(\d+)/;
    const match = url.match(pattern);
    return match ? match[1] : null;
}

// 从抖音URL提取sec_uid
function extractSecUidFromDouyin(url) {
    // 匹配抖音URL: https://www.douyin.com/user/MS4wLjABAAAA...
    const pattern = /douyin\.com\/user\/([a-zA-Z0-9_-]+)/;
    const match = url.match(pattern);
    return match ? match[1] : null;
}

function isValidUrl(url) {
    return getUrlType(url) !== null;
}

function addCollectItem(url) {
    if (!isValidUrl(url)) return false;
    
    const urlType = getUrlType(url);
    let authorId = null;
    let secUid = null;
    let originalUrl = url;
    
    if (urlType === 'xingtu') {
        authorId = extractAuthorIdFromXingtu(url);
        if (!authorId) return false;
    } else if (urlType === 'douyin') {
        secUid = extractSecUidFromDouyin(url);
        if (!secUid) return false;
    }
    
    // 检查是否已存在（通过authorId或原始URL去重）
    const existingItem = collectItems.find(item => 
        (authorId && item.author_id === authorId) || 
        (secUid && item.sec_uid === secUid) ||
        item.original_url === originalUrl
    );
    if (existingItem) return false;
    
    collectItems.push({
        original_url: originalUrl,
        url_type: urlType,
        author_id: authorId,  // 星图URL直接有authorId，抖音URL需要后续获取
        sec_uid: secUid,      // 抖音URL的sec_uid
        xingtu_url: authorId ? `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${authorId}` : '',
        douyin_url: urlType === 'douyin' ? url : '',
        nickname: '',
        status: '待采集',
        collect_time: ''
    });
    
    return true;
}

function renderCollectTable() {
    const tbody = document.getElementById('collect-tbody');
    
    if (collectItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                    暂无采集数据，请导入采集目标
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = collectItems.map((item, index) => {
        // 显示原始URL（星图主页或抖音主页）
        const displayUrl = item.original_url || item.xingtu_url || item.douyin_url || '';
        
        return `
        <tr data-index="${index}">
            <td title="${displayUrl}">${displayUrl}</td>
            <td>${item.author_id || '-'}</td>
            <td>${item.nickname || ''}</td>
            <td>${item.fansLevel !== undefined ? item.fansLevel : '-'}</td>
            <td>
                <span class="status-tag ${getStatusClass(item.status)}">
                    ${item.status}
                </span>
            </td>
            <td>${item.collect_time || ''}</td>
        </tr>
    `;
    }).join('');
}

function getStatusClass(status) {
    if (status === '已完成') return 'success';
    if (status === '待采集') return 'pending';
    if (status.includes('采集中')) return 'processing';
    if (status.includes('失败')) return 'error';
    return 'pending';
}

async function importFromExcel() {
    const filePath = await ipcRenderer.invoke('select-file', [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
    ]);
    
    if (!filePath) return;
    
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let addedCount = 0;
        let skippedCount = 0;
        
        data.forEach(row => {
            if (row[0]) {
                const url = String(row[0]).trim();
                if (addCollectItem(url)) {
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }
        });
        
        renderCollectTable();
        showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
    } catch (err) {
        showToast('error', '导入失败', `无法读取Excel文件: ${err.message}`);
    }
}

async function importFromText() {
    const content = `
        <p style="margin-bottom: 10px; color: #666;">请输入URL，每行一个：</p>
        <textarea class="textarea" id="import-text" placeholder="请输入URL，每行一个。
支持格式：
https://www.xingtu.cn/ad/creator/author/douyin/xxx
https://www.douyin.com/user/xxx"></textarea>
    `;
    
    const result = await showModal('文本导入', content, [
        { text: '取消', value: false },
        { text: '导入', value: true, primary: true }
    ], () => {
        const textArea = document.getElementById('import-text');
        return textArea ? textArea.value : '';
    });
    
    if (result && result.confirmed && result.data) {
        const text = result.data;
        const lines = text.trim().split('\n');
        let addedCount = 0;
        let skippedCount = 0;
        
        lines.forEach(line => {
            const url = line.trim();
            if (url) {
                if (addCollectItem(url)) {
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }
        });
        
        renderCollectTable();
        showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
    }
}

async function importFromTxt() {
    const filePath = await ipcRenderer.invoke('select-file', [
        { name: 'Text Files', extensions: ['txt'] }
    ]);
    
    if (!filePath) return;
    
    const result = await ipcRenderer.invoke('read-file', filePath);
    
    if (!result.success) {
        showToast('error', '导入失败', `无法读取TXT文件: ${result.error}`);
        return;
    }
    
    const lines = result.content.split('\n');
    let addedCount = 0;
    let skippedCount = 0;
    
    lines.forEach(line => {
        const url = line.trim();
        if (url) {
            if (addCollectItem(url)) {
                addedCount++;
            } else {
                skippedCount++;
            }
        }
    });
    
    renderCollectTable();
    showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
}

// 采集状态控制变量
let isPaused = false;
let currentAccountIndex = 0;
let currentAccounts = [];

function updateCollectButtons(collecting) {
    isCollecting = collecting;
    document.getElementById('start-collect-btn').disabled = collecting;
    document.getElementById('pause-collect-btn').disabled = !collecting;
    document.getElementById('stop-collect-btn').disabled = !collecting;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 根据等级获取最大采集次数
function getMaxCollectCount(grade) {
    const counts = { 1: 5, 2: 500, 3: 500, 4: 800, 5: 800, 6: 800, 7: 800 };
    return counts[grade] || 0;
}

// 获取选中的采集字段
function getSelectedFields() {
    const fields = {};
    document.querySelectorAll('input[name="collect-field"]:checked').forEach(checkbox => {
        fields[checkbox.value] = true;
    });
    return fields;
}

// 全部采集结果数据
let collectedData = [];

async function startCollect() {
    if (collectItems.length === 0) {
        showToast('warning', '提示', '没有采集目标');
        return;
    }
    
    // 获取有效账号并检查采集次数
    currentAccounts = accounts.filter(a => {
        if (a.status !== '正常') return false;
        const maxCount = getMaxCollectCount(a.grade || 0);
        const collectedCount = a.collectedCount || 0;
        return collectedCount < maxCount;
    });
    
    if (currentAccounts.length === 0) {
        showToast('error', '错误', '没有可用的账号（账号失效或已达到最大采集次数）');
        return;
    }
    
    updateCollectButtons(true);
    isPaused = false;
    currentAccountIndex = 0;
    collectedData = [];
    
    // 获取账号模式
    const accountMode = settings?.account_mode || 'multi';
    const isSingleMode = accountMode === 'single';
    
    // 单账号模式使用指定账号
    if (isSingleMode) {
        const selectedCookies = settings?.single_account_cookies;
        if (selectedCookies) {
            const selectedAccount = currentAccounts.find(a => a.cookies === selectedCookies);
            if (selectedAccount) {
                currentAccounts = [selectedAccount];
            } else {
                showToast('warning', '提示', '指定的账号不可用，将使用第一个可用账号');
                currentAccounts = [currentAccounts[0]];
            }
        } else {
            showToast('warning', '提示', '未选择账号，将使用第一个可用账号');
            currentAccounts = [currentAccounts[0]];
        }
    }
    
    const selectedFields = getSelectedFields();
    const pendingItems = collectItems.filter(item => item.status !== '已完成');
    
    const modeText = isSingleMode ? '单账号模式' : '多账户轮询';
    showToast('info', '开始采集', `${modeText}：采集 ${pendingItems.length} 个目标，使用 ${currentAccounts.length} 个账号...`);
    
    for (let i = 0; i < collectItems.length; i++) {
        if (!isCollecting) break;
        
        while (isPaused && isCollecting) {
            await sleep(500);
        }
        
        if (!isCollecting) break;
        
        const item = collectItems[i];
        if (item.status === '已完成') continue;
        
        // 获取当前账号
        let account = currentAccounts[currentAccountIndex];
        let maxCount = getMaxCollectCount(account.grade || 0);
        let collectedCount = account.collectedCount || 0;
        
        // 如果当前账号已达上限，切换到下一个可用账号
        while (collectedCount >= maxCount) {
            currentAccountIndex = (currentAccountIndex + 1) % currentAccounts.length;
            account = currentAccounts[currentAccountIndex];
            maxCount = getMaxCollectCount(account.grade || 0);
            collectedCount = account.collectedCount || 0;
            
            // 如果所有账号都已达上限
            if (currentAccounts.every(a => (a.collectedCount || 0) >= getMaxCollectCount(a.grade || 0))) {
                showToast('warning', '采集终止', '所有账号已达到最大采集次数');
                updateCollectButtons(false);
                return;
            }
        }
        
        collectItems[i].status = `采集中...(${account.remark || account.nickName})`;
        renderCollectTable();
        
        try {
            let authorId = item.author_id;
            
            // 如果是抖音URL，需要先通过搜索API获取authorId
            if (!authorId && item.url_type === 'douyin' && item.original_url) {
                collectItems[i].status = `获取达人ID中...(${account.remark || account.nickName})`;
                renderCollectTable();
                
                const searchResult = await ipcRenderer.invoke('search-author-by-douyin-url', item.original_url, account.cookies);
                
                if (searchResult.success && searchResult.authorId) {
                    authorId = searchResult.authorId;
                    collectItems[i].author_id = authorId;
                    collectItems[i].xingtu_url = `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${authorId}`;
                    if (searchResult.nickName) {
                        collectItems[i].nickname = searchResult.nickName;
                    }
                } else {
                    collectItems[i].status = `失败: ${searchResult.message || '无法获取达人ID'}`;
                    renderCollectTable();
                    continue;
                }
                
                await sleep(500);
                collectItems[i].status = `采集中...(${account.remark || account.nickName})`;
                renderCollectTable();
            }
            
            if (!authorId) {
                collectItems[i].status = '失败: 无法获取达人ID';
                renderCollectTable();
                continue;
            }
            
            // 调用星图采集API
            const result = await ipcRenderer.invoke('collect-xingtu-blogger', authorId, account.cookies, selectedFields);
            
            if (result.success) {
                collectItems[i].status = '已完成';
                collectItems[i].nickname = result.data['达人昵称'] || collectItems[i].nickname || '';
                collectItems[i].fansLevel = formatFansCount(result.data['粉丝数']) || '';
                collectItems[i].collect_time = new Date().toLocaleString('zh-CN');
                collectItems[i].collectedData = result.data;
                collectedData.push(result.data);
                
                // 更新账号已采集次数
                const accountIndex = accounts.findIndex(a => a.cookies === account.cookies);
                if (accountIndex >= 0) {
                    accounts[accountIndex].collectedCount = (accounts[accountIndex].collectedCount || 0) + 1;
                }
                account.collectedCount = (account.collectedCount || 0) + 1;
            } else {
                collectItems[i].status = `失败: ${result.errors?.join('; ') || '未知错误'}`;
            }
        } catch (err) {
            collectItems[i].status = `失败: ${err.message}`;
        }
        
        renderCollectTable();
        
        // 切换账号
        currentAccountIndex = (currentAccountIndex + 1) % currentAccounts.length;
    }
    
    // 保存账号采集次数
    await saveJsonData(ACCOUNTS_FILE, accounts);
    renderAccountTable();
    
    updateCollectButtons(false);
    
    const successCount = collectItems.filter(item => item.status === '已完成').length;
    showToast('success', '采集完成', `完成 ${successCount}/${collectItems.length} 个目标`);
}

function pauseCollect() {
    isPaused = !isPaused;
    const btn = document.getElementById('pause-collect-btn');
    if (isPaused) {
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            继续采集
        `;
        showToast('info', '已暂停', '采集已暂停');
    } else {
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            暂停采集
        `;
        showToast('info', '继续', '采集继续进行');
    }
}

function stopCollect() {
    isCollecting = false;
    isPaused = false;
    updateCollectButtons(false);
    showToast('info', '已停止', '采集已停止');
}

async function clearCollectList() {
    if (collectItems.length === 0) return;
    
    const confirmed = await showConfirm('确认清空', '确定要清空采集列表吗？');
    if (confirmed) {
        collectItems = [];
        renderCollectTable();
        showToast('success', '已清空', '采集列表已清空');
    }
}

async function saveToExcel() {
    // 获取已完成采集的项目
    const completedItems = collectItems.filter(item => item.status === '已完成' && item.collectedData);
    
    if (completedItems.length === 0) {
        showToast('warning', '提示', '没有已采集的数据可保存');
        return;
    }
    
    const defaultFilename = settings?.local?.filename || 'collected_data.xlsx';
    const defaultPath = settings?.local?.path || '';
    
    const savePath = await ipcRenderer.invoke('select-save-path', {
        title: '保存Excel文件',
        defaultPath: path.join(defaultPath, defaultFilename),
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    
    if (!savePath) return;
    
    try {
        const XLSX = require('xlsx');
        
        // 导出采集到的详细数据
        const exportData = completedItems.map(item => {
            const data = item.collectedData || {};
            return {
                '达人ID': item.user_id,
                '星图主页': item.xingtu_url,
                '抖音主页': item.douyin_url,
                '采集时间': item.collect_time || '',
                ...data
            };
        });
        
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '采集数据');
        XLSX.writeFile(wb, savePath);
        
        showToast('success', '保存成功', `已保存 ${completedItems.length} 条数据到: ${savePath}`);
    } catch (err) {
        showToast('error', '保存失败', `保存Excel失败: ${err.message}`);
    }
}

function initCollectPage() {
    document.getElementById('excel-import-btn').addEventListener('click', importFromExcel);
    document.getElementById('text-import-btn').addEventListener('click', importFromText);
    document.getElementById('txt-import-btn').addEventListener('click', importFromTxt);
    document.getElementById('start-collect-btn').addEventListener('click', startCollect);
    document.getElementById('pause-collect-btn').addEventListener('click', pauseCollect);
    document.getElementById('stop-collect-btn').addEventListener('click', stopCollect);
    document.getElementById('clear-list-btn').addEventListener('click', clearCollectList);
    document.getElementById('save-excel-btn').addEventListener('click', saveToExcel);
    
    renderCollectTable();
}

// ==================== 达人列表页面 ====================

let bloggerList = [];
let isFetching = false;
let capturedRequest = null;

// 监听请求捕获事件
ipcRenderer.on('blogger-request-captured', (event, captured) => {
    if (captured) {
        capturedRequest = true;
        document.getElementById('start-fetch-btn').disabled = false;
        showToast('success', '捕获成功', '已捕获请求参数，可以开始获取达人列表');
    }
});

async function openBloggerBrowser() {
    const validAccounts = accounts.filter(a => a.status === '正常');
    if (validAccounts.length === 0) {
        showToast('error', '错误', '没有可用的账号，请先添加并验证账号');
        return;
    }
    
    const cookies = validAccounts[0].cookies;
    showToast('info', '正在打开', '正在打开达人广场...');
    
    const result = await ipcRenderer.invoke('open-blogger-browser', cookies);
    if (result.success) {
        showToast('info', '提示', '请在打开的窗口中筛选达人，系统将自动捕获请求参数');
    } else {
        showToast('error', '打开失败', result.message);
    }
}

async function startFetchBloggers() {
    if (!capturedRequest) {
        showToast('warning', '提示', '请先打开达人广场并进行筛选操作');
        return;
    }
    
    const maxPages = parseInt(document.getElementById('max-pages-input').value) || 500;
    
    isFetching = true;
    document.getElementById('start-fetch-btn').disabled = true;
    document.getElementById('stop-fetch-btn').disabled = false;
    
    const capturedReq = await ipcRenderer.invoke('get-captured-request');
    if (!capturedReq) {
        showToast('error', '错误', '获取请求参数失败');
        isFetching = false;
        return;
    }
    
    showToast('info', '开始获取', `开始获取达人列表，最多 ${maxPages} 页...`);
    
    for (let page = 1; page <= maxPages && isFetching; page++) {
        document.getElementById('fetch-status').textContent = `正在获取第 ${page} 页...`;
        
        const result = await ipcRenderer.invoke('fetch-blogger-list', page, capturedReq);
        
        if (!result.success) {
            showToast('error', '获取失败', result.message);
            break;
        }
        
        if (result.data.length === 0) {
            showToast('info', '完成', '已获取全部数据');
            break;
        }
        
        // TODO: 根据星图实际返回数据结构处理
        result.data.forEach(item => {
            bloggerList.push({
                // 根据实际数据结构调整字段映射
                ...item
            });
        });
        
        renderBloggerList();
        
        await sleep(500);
    }
    
    isFetching = false;
    document.getElementById('start-fetch-btn').disabled = false;
    document.getElementById('stop-fetch-btn').disabled = true;
    document.getElementById('fetch-status').textContent = `共获取 ${bloggerList.length} 条数据`;
}

function stopFetchBloggers() {
    isFetching = false;
    document.getElementById('stop-fetch-btn').disabled = true;
    showToast('info', '已停止', '获取已停止');
}

function renderBloggerList() {
    const tbody = document.getElementById('blogger-list-tbody');
    
    if (bloggerList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="15" style="text-align: center; padding: 40px; color: #999;">
                    暂无数据，请先获取达人列表
                </td>
            </tr>
        `;
        return;
    }
    
    // TODO: 根据星图实际数据结构渲染表格
    tbody.innerHTML = bloggerList.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td title="${item.xingtu_url || ''}">${item.xingtu_url || '-'}</td>
            <td title="${item.douyin_url || ''}">${item.douyin_url || '-'}</td>
            <td>${item.nickname || '-'}</td>
            <td>${item.location || '-'}</td>
            <td>${item.personal_tags || '-'}</td>
            <td>${item.content_tags || '-'}</td>
            <td>${item.gender || '-'}</td>
            <td>${item.fans_count || '-'}</td>
            <td>${item.fans_count_wan || '-'}</td>
            <td>${item.play_median || '-'}</td>
            <td>${item.interact_median || '-'}</td>
            <td>${item.completion_rate || '-'}</td>
            <td>${item.video_price || '-'}</td>
            <td>${item.live_price || '-'}</td>
        </tr>
    `).join('');
}

async function clearBloggerList() {
    if (bloggerList.length === 0) return;
    
    const confirmed = await showConfirm('确认清空', '确定要清空达人列表吗？');
    if (confirmed) {
        bloggerList = [];
        renderBloggerList();
        showToast('success', '已清空', '达人列表已清空');
    }
}

async function exportBloggerList() {
    if (bloggerList.length === 0) {
        showToast('warning', '提示', '没有数据可导出');
        return;
    }
    
    const savePath = await ipcRenderer.invoke('select-save-path', {
        title: '导出达人列表',
        defaultPath: '达人列表.xlsx',
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    
    if (!savePath) return;
    
    try {
        const XLSX = require('xlsx');
        
        // TODO: 根据实际数据结构调整导出字段
        const exportData = bloggerList.map((item, index) => ({
            '序号': index + 1,
            '星图主页': item.xingtu_url || '',
            '抖音主页': item.douyin_url || '',
            '达人昵称': item.nickname || '',
            '归属地': item.location || '',
            '个人标签': item.personal_tags || '',
            '内容标签': item.content_tags || '',
            '性别': item.gender || '',
            '粉丝数': item.fans_count || '',
            '粉丝数-万': item.fans_count_wan || '',
            '播放中位数': item.play_median || '',
            '互动中位数': item.interact_median || '',
            '完播率': item.completion_rate || '',
            '视频报价': item.video_price || '',
            '直播报价': item.live_price || ''
        }));
        
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '达人列表');
        XLSX.writeFile(wb, savePath);
        
        showToast('success', '导出成功', `数据已导出到: ${savePath}`);
    } catch (err) {
        showToast('error', '导出失败', `导出Excel失败: ${err.message}`);
    }
}

function initBloggerListPage() {
    document.getElementById('open-browser-btn').addEventListener('click', openBloggerBrowser);
    document.getElementById('start-fetch-btn').addEventListener('click', startFetchBloggers);
    document.getElementById('stop-fetch-btn').addEventListener('click', stopFetchBloggers);
    document.getElementById('clear-blogger-list-btn').addEventListener('click', clearBloggerList);
    document.getElementById('export-blogger-btn').addEventListener('click', exportBloggerList);
    
    renderBloggerList();
}

// ==================== 授权信息页面 ====================

async function loadLicenseInfo() {
    // 获取机器码
    const machineCode = await ipcRenderer.invoke('get-machine-code');
    document.getElementById('license-machine-code').textContent = machineCode;
    
    // 获取授权信息
    const info = await ipcRenderer.invoke('get-license-info');
    
    if (info) {
        currentMemberLevel = info.member_level;
        document.getElementById('license-key').textContent = info.license_key;
        
        const levelEl = document.getElementById('license-level');
        levelEl.textContent = info.member_level;
        levelEl.className = 'license-value license-level ' + info.member_level.toLowerCase();
        
        document.getElementById('license-expire').textContent = 
            new Date(info.expire_at).toLocaleString('zh-CN');
        document.getElementById('license-days').textContent = info.days_remaining + ' 天';
    } else {
        currentMemberLevel = null;
        document.getElementById('license-key').textContent = '未激活';
        document.getElementById('license-level').textContent = '-';
        document.getElementById('license-level').className = 'license-value license-level';
        document.getElementById('license-expire').textContent = '-';
        document.getElementById('license-days').textContent = '-';
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('success', '复制成功', '已复制到剪贴板');
    } catch (err) {
        showToast('error', '复制失败', '无法复制到剪贴板');
    }
}

async function changeLicense() {
    const content = `
        <div class="form-row">
            <label class="form-label">新授权码:</label>
            <input type="text" class="input" id="new-license-key" placeholder="请输入新的授权码" style="flex: 1;">
        </div>
    `;
    
    const result = await showModal('更换授权码', content, [
        { text: '取消', value: false },
        { text: '确定更换', value: true, primary: true }
    ], () => {
        return document.getElementById('new-license-key')?.value.trim() || '';
    });
    
    if (result && result.confirmed && result.data) {
        const newKey = result.data;
        if (!newKey) {
            showToast('warning', '提示', '请输入新的授权码');
            return;
        }
        
        showToast('info', '验证中', '正在验证新授权码...');
        
        // 先解绑当前授权
        await ipcRenderer.invoke('unbind-license');
        
        // 激活新授权
        const activateResult = await ipcRenderer.invoke('activate-license', newKey);
        
        if (activateResult.success) {
            showToast('success', '更换成功', '授权码已更换');
            loadLicenseInfo();
        } else {
            showToast('error', '更换失败', activateResult.message);
        }
    }
}

async function unbindLicense() {
    const confirmed = await showConfirm('确认解绑', '确定要解绑当前授权码吗？解绑后需要重新激活才能使用软件。');
    
    if (confirmed) {
        showToast('info', '处理中', '正在解绑授权...');
        
        const result = await ipcRenderer.invoke('unbind-license');
        
        if (result.success) {
            showToast('success', '解绑成功', '授权已解绑，软件将退出');
            setTimeout(() => {
                ipcRenderer.invoke('quit-app');
            }, 1500);
        } else {
            showToast('error', '解绑失败', result.message);
        }
    }
}

function initLicensePage() {
    document.getElementById('copy-machine-code-btn').addEventListener('click', () => {
        const code = document.getElementById('license-machine-code').textContent;
        copyToClipboard(code);
    });
    
    document.getElementById('copy-license-key-btn').addEventListener('click', () => {
        const key = document.getElementById('license-key').textContent;
        if (key && key !== '未激活') {
            copyToClipboard(key);
        }
    });
    
    document.getElementById('change-license-btn').addEventListener('click', changeLicense);
    document.getElementById('unbind-license-btn').addEventListener('click', unbindLicense);
    
    loadLicenseInfo();
}

// ==================== 应用初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initAccountPage();
    initSettingsPage();
    initCollectPage();
    initBloggerListPage();
    initLicensePage();
    
    // 加载会员等级
    const info = await ipcRenderer.invoke('get-license-info');
    if (info) {
        currentMemberLevel = info.member_level;
    }
});
