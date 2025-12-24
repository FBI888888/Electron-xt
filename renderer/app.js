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

function normalizePortraitDistributionText(input, options = {}) {
    const {
        decimals = 1,
        mapKeys = null,
    } = options;

    if (input === null || input === undefined) return '';
    const str = String(input).trim();
    if (!str) return '';
    if (/%/.test(str) && !/[：:]/.test(str)) return str;

    const parts = str.split(/[、，,;；]\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return str;

    const items = [];
    for (const p of parts) {
        const kv = p.split(/[：:]/);
        if (kv.length < 2) return str;
        const rawKey = String(kv[0]).trim();
        const rawValStr = String(kv.slice(1).join(':')).trim();
        const valHasPercent = /%/.test(rawValStr);
        const rawNum = Number(rawValStr.replace('%', '').trim());
        const val = Number.isFinite(rawNum) ? rawNum : 0;
        const key = mapKeys && Object.prototype.hasOwnProperty.call(mapKeys, rawKey) ? mapKeys[rawKey] : rawKey;
        items.push({ key, value: val, hasPercent: valHasPercent });
    }

    const values = items.map(i => i.value);
    const allPercent = items.every(i => i.hasPercent);
    const sum = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    if (sum <= 0) return str;

    let mode = 'count';
    if (!allPercent && sum <= 1.0000001 && values.every(v => v >= 0 && v <= 1.0000001)) {
        mode = 'ratio';
    } else if (allPercent || (sum <= 100.0000001 && values.every(v => v >= 0 && v <= 100.0000001))) {
        mode = 'percent';
    }

    return items.map((it) => {
        const pct = mode === 'ratio'
            ? it.value * 100
            : mode === 'percent'
                ? it.value
                : (it.value / sum) * 100;
        return `${it.key}${pct.toFixed(decimals)}%`;
    }).join('、');
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

function showDisclaimerModal() {
    return new Promise((resolve) => {
        const container = document.getElementById('modal-container');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.background = 'rgba(0, 0, 0, 0.7)';

        overlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="modal-header" style="font-size: 18px; font-weight: 600;">软件使用免责声明</div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="line-height: 1.8; color: #555;">
                        <p style="margin-bottom: 12px;">本软件仅提供公开信息采集工具功能，仅支持采集抖音星图平台已公开的达人主页信息，不具备获取非公开数据的能力。</p>
                        <p style="margin-bottom: 12px;">使用者需遵守相关法律法规及平台规则，严禁违规使用软件。</p>
                        <p style="margin-bottom: 12px;">因违规使用导致的法律责任、第三方索赔等，均由使用者自行承担，与开发者无关。</p>
                        <p style="font-weight: 600; color: #333;">您使用本软件即视为同意本声明全部条款。</p>
                    </div>
                </div>
                <div class="modal-footer" style="justify-content: center; gap: 20px;">
                    <button class="btn btn-secondary" id="disclaimer-reject" style="min-width: 100px;">拒绝</button>
                    <button class="btn btn-primary" id="disclaimer-accept" style="min-width: 100px;">接受声明</button>
                </div>
            </div>
        `;

        container.appendChild(overlay);

        document.getElementById('disclaimer-accept').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });

        document.getElementById('disclaimer-reject').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
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

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

async function loadAccounts() {
    accounts = await loadJsonData(ACCOUNTS_FILE, []);
    
    // 检查日期，每日归零已采集次数
    const today = getTodayDate();
    let needSave = false;
    for (const account of accounts) {
        if (account.lastCollectDate !== today) {
            account.collectedCount = 0;
            account.lastCollectDate = today;
            needSave = true;
        }
    }
    
    // 如果有更新则保存
    if (needSave) {
        await saveJsonData(ACCOUNTS_FILE, accounts);
    }
    
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

    logLinkConvert('TXT导入：选择文件', { filePath });
    
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

    const CONCURRENCY = 2;
    const pendingIndices = [];
    for (let i = 0; i < collectItems.length; i++) {
        if (collectItems[i].status !== '已完成') {
            pendingIndices.push(i);
        }
    }

    let currentIdx = 0;
    const inProgressByCookies = {};
    let noAccountToastShown = false;

    function reserveAccount() {
        if (!currentAccounts || currentAccounts.length === 0) return null;

        for (let tries = 0; tries < currentAccounts.length; tries++) {
            const account = currentAccounts[currentAccountIndex];
            const maxCount = getMaxCollectCount(account.grade || 0);
            const collectedCount = account.collectedCount || 0;
            const inProgress = inProgressByCookies[account.cookies] || 0;

            if (collectedCount + inProgress < maxCount) {
                inProgressByCookies[account.cookies] = inProgress + 1;
                currentAccountIndex = (currentAccountIndex + 1) % currentAccounts.length;
                return account;
            }

            currentAccountIndex = (currentAccountIndex + 1) % currentAccounts.length;
        }

        return null;
    }

    function releaseAccount(account) {
        if (!account || !account.cookies) return;
        const v = inProgressByCookies[account.cookies] || 0;
        inProgressByCookies[account.cookies] = Math.max(0, v - 1);
    }

    async function worker(workerId) {
        while (isCollecting && currentIdx < pendingIndices.length) {
            const idx = currentIdx++;
            if (idx >= pendingIndices.length) break;

            while (isPaused && isCollecting) {
                await sleep(150);
            }

            if (!isCollecting) break;

            const itemIndex = pendingIndices[idx];
            const item = collectItems[itemIndex];
            if (!item || item.status === '已完成') continue;

            const account = reserveAccount();
            if (!account) {
                if (!noAccountToastShown) {
                    noAccountToastShown = true;
                    showToast('warning', '采集终止', '所有账号已达到最大采集次数');
                }
                isCollecting = false;
                break;
            }

            collectItems[itemIndex].status = `采集中...(${account.remark || account.nickName})`;
            renderCollectTable();

            try {
                let authorId = item.author_id;

                // 如果是抖音URL，需要先通过搜索API获取authorId
                if (!authorId && item.url_type === 'douyin' && item.original_url) {
                    collectItems[itemIndex].status = `获取达人ID中...(${account.remark || account.nickName})`;
                    renderCollectTable();

                    const searchResult = await ipcRenderer.invoke('search-author-by-douyin-url', item.original_url, account.cookies);

                    if (searchResult.success && searchResult.authorId) {
                        authorId = searchResult.authorId;
                        collectItems[itemIndex].author_id = authorId;
                        collectItems[itemIndex].xingtu_url = `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${authorId}`;
                        if (searchResult.nickName) {
                            collectItems[itemIndex].nickname = searchResult.nickName;
                        }
                    } else {
                        collectItems[itemIndex].status = `失败: ${searchResult.message || '无法获取达人ID'}`;
                        renderCollectTable();
                        continue;
                    }

                    await sleep(150);
                    collectItems[itemIndex].status = `采集中...(${account.remark || account.nickName})`;
                    renderCollectTable();
                }

                if (!authorId) {
                    collectItems[itemIndex].status = '失败: 无法获取达人ID';
                    renderCollectTable();
                    continue;
                }

                // 调用星图采集API
                const result = await ipcRenderer.invoke('collect-xingtu-blogger', authorId, account.cookies, selectedFields);

                if (result.success) {
                    collectItems[itemIndex].status = '已完成';
                    collectItems[itemIndex].author_id = authorId;
                    collectItems[itemIndex].nickname = result.data['达人昵称'] || collectItems[itemIndex].nickname || '';
                    collectItems[itemIndex].fansLevel = formatFansCount(result.data['粉丝数']) || '';
                    collectItems[itemIndex].collect_time = new Date().toLocaleString('zh-CN');
                    collectItems[itemIndex].collectedData = result.data;
                    collectedData.push(result.data);

                    // 更新账号已采集次数
                    const accountIndex = accounts.findIndex(a => a.cookies === account.cookies);
                    if (accountIndex >= 0) {
                        accounts[accountIndex].collectedCount = (accounts[accountIndex].collectedCount || 0) + 1;
                    }
                    account.collectedCount = (account.collectedCount || 0) + 1;
                } else {
                    collectItems[itemIndex].status = `失败: ${result.errors?.join('; ') || '未知错误'}`;
                }
            } catch (err) {
                collectItems[itemIndex].status = `失败: ${err.message}`;
            } finally {
                releaseAccount(account);
            }

            renderCollectTable();
            await sleep(80);
        }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker(i + 1));
        if (i < CONCURRENCY - 1) {
            await sleep(300);
        }
    }

    await Promise.all(workers);
    
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

    const isSvip = await ipcRenderer.invoke('is-svip');
    
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

        const toWan = (value) => {
            if (value === undefined || value === null || value === '') return '';
            const s = String(value).trim();
            if (!s) return '';
            if (/w$/i.test(s)) return s;
            const n = parseFloat(s);
            if (Number.isNaN(n)) return s;
            return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n);
        };

        const prefixFields = [
            '星图ID',
            '星图主页',
            '达人昵称',
            ...(isSvip ? ['微信号'] : []),
            '归属地',
            '性别',
            '个人介绍',
            '抖音ID',
            '抖音主页',
            'MCN机构',
            '粉丝数',
            '粉丝数-万',
            '月连接用户数',
            '月连接用户数-万',
            '达人类型',
            '内容主题'
        ];

        const skipKeys = new Set(prefixFields);
        skipKeys.add('authorId');
        skipKeys.add('微信号');

        // 后续字段按首次出现顺序收集，确保列顺序稳定，且最后一列可以固定为“采集时间”
        const extraKeys = [];
        completedItems.forEach((item) => {
            const data = item.collectedData || {};
            Object.keys(data).forEach((k) => {
                if (!skipKeys.has(k) && !extraKeys.includes(k)) {
                    extraKeys.push(k);
                }
            });
        });
        
        // 导出采集到的详细数据
        const exportData = completedItems.map(item => {
            const data = item.collectedData || {};

            const row = {};
            row['星图ID'] = item.author_id || item.user_id || data.authorId || data.author_id || '';
            row['星图主页'] = item.xingtu_url || '';
            row['达人昵称'] = data['达人昵称'] || '';
            if (isSvip) {
                row['微信号'] = data['微信号'] || '';
            }
            row['归属地'] = data['归属地'] || '';
            row['性别'] = data['性别'] || '';
            row['个人介绍'] = data['个人介绍'] || '';
            row['抖音ID'] = data['抖音ID'] || '';
            row['抖音主页'] = item.douyin_url || data['抖音主页'] || '';
            row['MCN机构'] = data['MCN机构'] || '';
            row['粉丝数'] = data['粉丝数'] || '';
            row['粉丝数-万'] = toWan(data['粉丝数']);
            row['月连接用户数'] = data['月连接用户数'] || '';
            row['月连接用户数-万'] = toWan(data['月连接用户数']);
            row['达人类型'] = data['达人类型'] || '';
            row['内容主题'] = data['内容主题'] || '';

            // 后面的字段保持顺序不动（按首次出现顺序），并移除 authorId
            // 对用户画像分布字段做格式化处理
            const genderKeyMap = { male: '男性', female: '女性' };
            extraKeys.forEach((k) => {
                let value = data[k] !== undefined ? data[k] : '';
                
                // 对用户画像字段做兜底格式化
                if (k === '用户画像-性别分布') {
                    value = normalizePortraitDistributionText(value, { decimals: 2, mapKeys: genderKeyMap });
                } else if (k && k.startsWith('用户画像-')) {
                    value = normalizePortraitDistributionText(value, { decimals: 1 });
                }
                
                row[k] = value;
            });

            // 采集时间放在后续字段区域（不参与前置字段顺序）
            row['采集时间'] = item.collect_time || '';

            return row;
        });
        
        const header = [...prefixFields, ...extraKeys, '采集时间'];
        const ws = XLSX.utils.json_to_sheet(exportData, { header });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '采集数据');

        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        const writeResult = await ipcRenderer.invoke('write-binary-file', savePath, buffer);
        if (!writeResult || !writeResult.success) {
            throw new Error(writeResult?.error || '写入文件失败');
        }

        const exists = await ipcRenderer.invoke('file-exists', savePath);
        if (!exists) {
            throw new Error('写入完成但未检测到文件');
        }

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
        
        // 解析星图API返回的数据结构
        result.data.forEach(author => {
            const attrs = author.attribute_datas || {};
            const starId = attrs.id || author.star_id;
            
            // 解析个人标签
            let personalTags = '';
            try {
                const tagsRelation = JSON.parse(attrs.tags_relation || '{}');
                personalTags = Object.keys(tagsRelation).join(', ');
            } catch (e) {}
            
            // 解析内容标签
            let contentTags = '';
            try {
                const contentLabels = JSON.parse(attrs.content_theme_labels_180d || '[]');
                contentTags = contentLabels.slice(0, 5).join(', ');
            } catch (e) {}
            
            // 解析报价信息
            let videoPrice = '-';
            if (author.task_infos && author.task_infos.length > 0) {
                const priceInfo = author.task_infos[0].price_infos;
                if (priceInfo && priceInfo.length > 0) {
                    // 查找 video_type=1 的报价（1-20秒短视频）
                    const shortVideoPrice = priceInfo.find(p => p.video_type === 1);
                    if (shortVideoPrice) {
                        videoPrice = shortVideoPrice.price;
                    } else {
                        videoPrice = priceInfo[0].price;
                    }
                }
            }
            
            // 数字转万的辅助函数
            const toWan = (num) => {
                const n = parseInt(num) || 0;
                return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : n;
            };
            
            const follower = parseInt(attrs.follower) || 0;
            const playMedian = parseInt(attrs.vv_median_30d) || 0;
            const interactMedian = parseInt(attrs.interaction_median_30d) || 0;
            const expectedPlay = parseInt(attrs.expected_play_num) || 0;
            
            bloggerList.push({
                avatar_uri: attrs.avatar_uri || '',
                xingtu_url: `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${starId}`,
                nickname: attrs.nick_name || '',
                location: `${attrs.province || ''}${attrs.city || ''}`,
                gender: attrs.gender === '1' ? '男' : attrs.gender === '2' ? '女' : '-',
                personal_tags: personalTags,
                content_tags: contentTags,
                fans_count: follower,
                fans_count_wan: toWan(follower),
                fans_increment_30d: attrs.fans_increment_within_30d || '-',
                play_median: playMedian,
                play_median_wan: toWan(playMedian),
                interact_median: interactMedian,
                interact_median_wan: toWan(interactMedian),
                completion_rate: attrs.play_over_rate_within_30d ? (parseFloat(attrs.play_over_rate_within_30d) * 100).toFixed(2) + '%' : '-',
                interact_rate: attrs.interact_rate_within_30d ? (parseFloat(attrs.interact_rate_within_30d) * 100).toFixed(2) + '%' : '-',
                expected_play_num: expectedPlay,
                expected_play_num_wan: toWan(expectedPlay),
                ecom_level: attrs.author_ecom_level || '-',
                star_index: attrs.link_star_index || '-',
                spread_index: attrs.link_spread_index || '-',
                shopping_index: attrs.link_shopping_index || '-',
                price_1_20: attrs.price_1_20 || '-',
                price_20_60: attrs.price_20_60 || '-',
                price_60: attrs.price_60 || '-',
                star_id: starId
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
                <td colspan="26" style="text-align: center; padding: 40px; color: #999;">
                    暂无数据，请先获取达人列表
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = bloggerList.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.avatar_uri ? `<img src="${item.avatar_uri}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">` : '-'}</td>
            <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><a href="${item.xingtu_url || '#'}" target="_blank" style="color: #007bff; text-decoration: none;">${item.xingtu_url || '-'}</a></td>
            <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.nickname || '-'}</td>
            <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.location || '-'}</td>
            <td>${item.gender || '-'}</td>
            <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.personal_tags || ''}">${item.personal_tags || '-'}</td>
            <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.content_tags || ''}">${item.content_tags || '-'}</td>
            <td>${item.fans_count || '-'}</td>
            <td>${item.fans_count_wan || '-'}</td>
            <td>${item.fans_increment_30d || '-'}</td>
            <td>${item.play_median || '-'}</td>
            <td>${item.play_median_wan || '-'}</td>
            <td>${item.interact_median || '-'}</td>
            <td>${item.interact_median_wan || '-'}</td>
            <td>${item.completion_rate || '-'}</td>
            <td>${item.interact_rate || '-'}</td>
            <td>${item.expected_play_num || '-'}</td>
            <td>${item.expected_play_num_wan || '-'}</td>
            <td>${item.ecom_level || '-'}</td>
            <td>${item.star_index || '-'}</td>
            <td>${item.spread_index || '-'}</td>
            <td>${item.shopping_index || '-'}</td>
            <td>${item.price_1_20 || '-'}</td>
            <td>${item.price_20_60 || '-'}</td>
            <td>${item.price_60 || '-'}</td>
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
        
        const exportData = bloggerList.map((item, index) => ({
            '序号': index + 1,
            '星图主页': item.xingtu_url || '',
            '达人昵称': item.nickname || '',
            '归属地': item.location || '',
            '性别': item.gender || '',
            '个人标签': item.personal_tags || '',
            '内容标签': item.content_tags || '',
            '粉丝数': item.fans_count || '',
            '粉丝数-万': item.fans_count_wan || '',
            '30天涨粉': item.fans_increment_30d || '',
            '播放中位数': item.play_median || '',
            '播放中位-万': item.play_median_wan || '',
            '互动中位数': item.interact_median || '',
            '互动中位-万': item.interact_median_wan || '',
            '完播率': item.completion_rate || '',
            '互动率': item.interact_rate || '',
            '预估播放量': item.expected_play_num || '',
            '预估播放-万': item.expected_play_num_wan || '',
            '电商等级': item.ecom_level || '',
            '星图指数': item.star_index || '',
            '传播指数': item.spread_index || '',
            '种草指数': item.shopping_index || '',
            '1-20秒报价': item.price_1_20 || '',
            '20-60秒报价': item.price_20_60 || '',
            '60秒+报价': item.price_60 || ''
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

// ==================== 链接转换页面 ====================

let linkConvertList = [];
let isConverting = false;

function logLinkConvert(message, extra) {
    if (extra !== undefined) {
        console.log(`[LinkConvert] ${message}`, extra);
    } else {
        console.log(`[LinkConvert] ${message}`);
    }
}

function addLinkConvertItem(originalLine) {
    const url = extractUrlFromText(originalLine);
    if (!url) {
        logLinkConvert('跳过：未提取到URL', { originalLine });
        return false;
    }
    if (!isDouyinUserUrl(url) && !isDouyinShortUrl(url)) {
        logLinkConvert('跳过：非抖音主页/短链', { originalLine, url });
        return false;
    }
    
    const existingItem = linkConvertList.find(item => item.extractedUrl === url || item.original === originalLine);
    if (existingItem) {
        logLinkConvert('跳过：重复链接', { originalLine, url });
        return false;
    }
    
    linkConvertList.push({
        original: originalLine,
        extractedUrl: url,
        douyinUrl: isDouyinUserUrl(url) ? url : '',
        xingtuNickName: '',
        xingtuUrl: '',
        status: 'pending',
        error: ''
    });

    logLinkConvert('已添加待转换项', { url, douyinUrl: isDouyinUserUrl(url) ? url : '' });
    return true;
}

// 从文本中提取URL
function extractUrlFromText(text) {
    // 匹配抖音链接
    const urlMatch = text.match(/https?:\/\/[^\s\u4e00-\u9fa5]+/);
    return urlMatch ? urlMatch[0] : null;
}

// 判断是否为抖音主页链接
function isDouyinUserUrl(url) {
    return url && url.includes('www.douyin.com/user/');
}

// 判断是否为抖音短链接
function isDouyinShortUrl(url) {
    return url && url.includes('v.douyin.com/');
}

async function importLinksFromExcel() {
    const filePath = await ipcRenderer.invoke('select-file', [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
    ]);
    
    if (!filePath) return;

    logLinkConvert('Excel导入：选择文件', { filePath });
    
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let addedCount = 0;
        let skippedCount = 0;
        
        data.forEach(row => {
            if (row[0]) {
                const line = String(row[0]).trim();
                if (line) {
                    if (addLinkConvertItem(line)) {
                        addedCount++;
                    } else {
                        skippedCount++;
                    }
                }
            }
        });
        
        renderLinkConvertList();
        document.getElementById('start-convert-btn').disabled = linkConvertList.length === 0;
        logLinkConvert('Excel导入完成', { addedCount, skippedCount, total: linkConvertList.length });
        showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
    } catch (err) {
        logLinkConvert('Excel导入失败', { message: err.message, stack: err.stack });
        showToast('error', '导入失败', `无法读取Excel文件: ${err.message}`);
    }
}

async function importLinksFromText() {
    const content = `
        <p style="margin-bottom: 10px; color: #666;">请输入链接，每行一个：</p>
        <textarea class="textarea" id="link-import-text" placeholder="请输入链接，每行一个。
支持格式：
https://v.douyin.com/xxxxx/
https://www.douyin.com/user/xxxxx"></textarea>
    `;
    
    const result = await showModal('文本导入', content, [
        { text: '取消', value: false },
        { text: '导入', value: true, primary: true }
    ], () => {
        const textArea = document.getElementById('link-import-text');
        return textArea ? textArea.value : '';
    });
    
    if (result && result.confirmed && result.data) {
        const text = result.data;
        const lines = text.trim().split('\n');
        let addedCount = 0;
        let skippedCount = 0;

        logLinkConvert('文本导入：开始处理', { lines: lines.length });
        
        lines.forEach(line => {
            const v = line.trim();
            if (v) {
                if (addLinkConvertItem(v)) {
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }
        });
        
        renderLinkConvertList();
        document.getElementById('start-convert-btn').disabled = linkConvertList.length === 0;
        logLinkConvert('文本导入完成', { addedCount, skippedCount, total: linkConvertList.length });
        showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
    }
}

async function importLinksFromTxt() {
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

    logLinkConvert('TXT导入：开始处理', { lines: lines.length });
    
    lines.forEach(line => {
        const v = line.trim();
        if (v) {
            if (addLinkConvertItem(v)) {
                addedCount++;
            } else {
                skippedCount++;
            }
        }
    });
    
    renderLinkConvertList();
    document.getElementById('start-convert-btn').disabled = linkConvertList.length === 0;
    logLinkConvert('TXT导入完成', { addedCount, skippedCount, total: linkConvertList.length });
    showToast('success', '导入成功', `成功导入 ${addedCount} 条，跳过 ${skippedCount} 条`);
}

// 转换单条（带重试）
async function convertSingleItem(item, index, cookies, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // 步骤1: 获取抖音主页URL
            if (!item.douyinUrl) {
                if (isDouyinShortUrl(item.extractedUrl)) {
                    logLinkConvert(`[${index}] 解析短链接 (尝试${attempt + 1})`, { shortUrl: item.extractedUrl });
                    const resolveResult = await ipcRenderer.invoke('resolve-douyin-short-link', item.extractedUrl);
                    logLinkConvert(`[${index}] 短链接解析返回`, resolveResult);
                    if (resolveResult.success) {
                        item.douyinUrl = resolveResult.userUrl;
                    } else {
                        throw new Error(resolveResult.message || '解析短链接失败');
                    }
                }
            }
            
            // 步骤2: 通过抖音主页获取星图作者ID + 星图昵称
            if (item.douyinUrl && !item.xingtuUrl) {
                logLinkConvert(`[${index}] 搜索星图authorId (尝试${attempt + 1})`, { douyinUrl: item.douyinUrl });
                const searchResult = await ipcRenderer.invoke('search-xingtu-author', item.douyinUrl, cookies);
                logLinkConvert(`[${index}] 星图搜索返回`, searchResult);
                if (searchResult.success && searchResult.authorId) {
                    item.xingtuUrl = `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${searchResult.authorId}`;
                    item.xingtuNickName = searchResult.nickName || '';
                    item.status = 'success';
                    logLinkConvert(`[${index}] 转换成功`, { douyinUrl: item.douyinUrl, xingtuUrl: item.xingtuUrl, xingtuNickName: item.xingtuNickName });
                    return true;
                } else if (searchResult.notRegistered) {
                    // 达人未入驻星图，标记为"无星图"，不重试
                    item.status = 'no_xingtu';
                    item.xingtuUrl = '';
                    item.xingtuNickName = '无星图';
                    logLinkConvert(`[${index}] 达人未入驻星图`, { douyinUrl: item.douyinUrl });
                    return true; // 返回true表示处理完成，不触发重试
                } else {
                    throw new Error(searchResult.message || '未找到星图达人');
                }
            }
            
            return true;
        } catch (err) {
            logLinkConvert(`[${index}] 尝试${attempt + 1}失败: ${err.message}`);
            if (attempt < maxRetries - 1) {
                const delay = 200 * (attempt + 1);
                logLinkConvert(`[${index}] 等待${delay}ms后重试...`);
                await sleep(delay);
            } else {
                item.status = 'failed';
                item.error = err.message;
                logLinkConvert(`[${index}] 最终失败`, { extractedUrl: item.extractedUrl, message: err.message });
                return false;
            }
        }
    }
    return false;
}

// 开始转换（双线程并发）
async function startConvert() {
    if (linkConvertList.length === 0) {
        showToast('warning', '提示', '没有链接可转换');
        return;
    }
    
    // 获取有效账号的cookies
    const validAccounts = accounts.filter(a => a.status === '正常' && a.cookies);
    if (validAccounts.length === 0) {
        showToast('error', '错误', '没有有效账号，请先添加并验证账号');
        return;
    }
    
    const cookies = validAccounts[0].cookies;
    const CONCURRENCY = 2; // 双线程并发

    logLinkConvert('开始转换', {
        total: linkConvertList.length,
        concurrency: CONCURRENCY,
        usingAccount: validAccounts[0].remark || validAccounts[0].nickName || 'unknown'
    });
    
    isConverting = true;
    document.getElementById('start-convert-btn').disabled = true;
    document.getElementById('stop-convert-btn').disabled = false;
    document.getElementById('link-excel-import-btn').disabled = true;
    document.getElementById('link-text-import-btn').disabled = true;
    document.getElementById('link-txt-import-btn').disabled = true;
    
    const statusEl = document.getElementById('convert-status');
    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;
    
    // 获取待处理的项目索引
    const pendingIndices = [];
    for (let i = 0; i < linkConvertList.length; i++) {
        if (linkConvertList[i].status !== 'success') {
            pendingIndices.push(i);
        }
    }
    
    let currentIdx = 0;
    
    // 工作线程函数
    async function worker(workerId) {
        while (isConverting && currentIdx < pendingIndices.length) {
            const idx = currentIdx++;
            if (idx >= pendingIndices.length) break;
            
            const itemIndex = pendingIndices[idx];
            const item = linkConvertList[itemIndex];
            
            logLinkConvert(`Worker${workerId} 处理第${itemIndex + 1}条`);
            item.status = 'processing';
            renderLinkConvertList();
            
            const success = await convertSingleItem(item, itemIndex + 1, cookies, 3);
            
            processedCount++;
            if (success && (item.status === 'success' || item.status === 'no_xingtu')) {
                successCount++;
            } else if (item.status === 'failed') {
                failCount++;
            }
            
            statusEl.textContent = `正在转换: ${processedCount}/${pendingIndices.length} (成功${successCount}/失败${failCount})`;
            renderLinkConvertList();
            
            // 短链解析需要间隔，避免浏览器资源抢夺；星图API请求也需要间隔
            await sleep(100);
        }
    }
    
    // 启动双线程，错开启动避免同时创建浏览器
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker(i + 1));
        if (i < CONCURRENCY - 1) {
            await sleep(500); // 错开启动
        }
    }
    
    await Promise.all(workers);
    
    isConverting = false;
    document.getElementById('start-convert-btn').disabled = false;
    document.getElementById('stop-convert-btn').disabled = true;
    document.getElementById('link-excel-import-btn').disabled = false;
    document.getElementById('link-text-import-btn').disabled = false;
    document.getElementById('link-txt-import-btn').disabled = false;
    statusEl.textContent = `转换完成: 成功 ${successCount}, 失败 ${failCount}`;

    logLinkConvert('转换结束', { successCount, failCount });
}

// 停止转换
function stopConvert() {
    isConverting = false;
    document.getElementById('start-convert-btn').disabled = false;
    document.getElementById('stop-convert-btn').disabled = true;
    document.getElementById('link-excel-import-btn').disabled = false;
    document.getElementById('link-text-import-btn').disabled = false;
    document.getElementById('link-txt-import-btn').disabled = false;
    showToast('info', '已停止', '转换已停止');
}

async function manualConvertLink(index) {
    if (isConverting) {
        showToast('warning', '提示', '正在批量转换中，请先停止后再手动转换');
        return;
    }

    const item = linkConvertList[index];
    if (!item) return;

    const validAccounts = accounts.filter(a => a.status === '正常' && a.cookies);
    if (validAccounts.length === 0) {
        showToast('error', '错误', '没有有效账号，请先添加并验证账号');
        return;
    }

    const cookies = validAccounts[0].cookies;

    logLinkConvert('手动转换单条', { index: index + 1, extractedUrl: item.extractedUrl });

    item.status = 'processing';
    item.error = '';
    item.xingtuNickName = '';
    item.xingtuUrl = '';
    renderLinkConvertList();

    const ok = await convertSingleItem(item, index + 1, cookies, 3);
    if (ok && (item.status === 'success' || item.status === 'no_xingtu')) {
        showToast('success', '转换成功', `第 ${index + 1} 条转换成功`);
    } else {
        showToast('error', '转换失败', `第 ${index + 1} 条转换失败：${item.error || '未知错误'}`);
    }

    renderLinkConvertList();
}

function showLinkConvertContextMenu(x, y, index) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="convert">转换链接</div>
    `;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.remove();

            if (action === 'convert') {
                manualConvertLink(index);
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

// 渲染链接转换列表
function renderLinkConvertList() {
    const tbody = document.getElementById('link-convert-tbody');
    
    if (linkConvertList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                    暂无数据，请导入链接文件
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = linkConvertList.map((item, index) => {
        let statusText = '';
        let statusClass = '';
        let rowStyle = '';
        
        switch (item.status) {
            case 'pending':
                statusText = '待转换';
                statusClass = 'status-tag pending';
                break;
            case 'processing':
                statusText = '转换中';
                statusClass = 'status-tag normal';
                break;
            case 'success':
                statusText = '成功';
                statusClass = 'status-tag normal';
                break;
            case 'no_xingtu':
                statusText = '成功';
                statusClass = 'status-tag normal';
                break;
            case 'failed':
                statusText = '失败';
                statusClass = 'status-tag error';
                rowStyle = 'background-color: #fff0f0;';
                break;
        }
        
        return `
            <tr style="${rowStyle}" data-index="${index}">
                <td>${index + 1}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;" title="${item.original}">${item.original}</td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;" title="${item.douyinUrl || item.error || ''}">${item.douyinUrl || (item.error ? `<span style="color: red;">${item.error}</span>` : '-')}</td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;" title="${item.xingtuNickName || ''}">${item.xingtuNickName || '-'}</td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">${item.xingtuUrl ? `<a href="${item.xingtuUrl}" target="_blank" style="color: #007bff;">${item.xingtuUrl}</a>` : '-'}</td>
            </tr>
        `;
    }).join('');

    // 绑定右键菜单
    tbody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const index = parseInt(row.dataset.index);
            showLinkConvertContextMenu(e.clientX, e.clientY, index);
        });
    });
}

// 清空链接列表
async function clearLinkConvertList() {
    if (linkConvertList.length === 0) return;
    
    const confirmed = await showConfirm('确认清空', '确定要清空链接列表吗？');
    if (confirmed) {
        linkConvertList = [];
        renderLinkConvertList();
        document.getElementById('start-convert-btn').disabled = true;
        showToast('success', '已清空', '链接列表已清空');
    }
}

// 导出链接列表
async function exportLinkConvertList() {
    if (linkConvertList.length === 0) {
        showToast('warning', '提示', '没有数据可导出');
        return;
    }
    
    const savePath = await ipcRenderer.invoke('select-save-path', {
        title: '导出链接转换结果',
        defaultPath: '链接转换结果.xlsx',
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    
    if (!savePath) return;
    
    try {
        const XLSX = require('xlsx');
        
        const exportData = linkConvertList.map((item, index) => ({
            '序号': index + 1,
            '状态': item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '待转换',
            '原始链接': item.original,
            '抖音主页': item.douyinUrl || '',
            '星图昵称': item.xingtuNickName || '',
            '星图主页': item.xingtuUrl || '',
            '错误信息': item.error || ''
        }));
        
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '链接转换结果');
        XLSX.writeFile(wb, savePath);
        
        showToast('success', '导出成功', `数据已导出到: ${savePath}`);
    } catch (err) {
        showToast('error', '导出失败', `导出Excel失败: ${err.message}`);
    }
}

function initLinkConvertPage() {
    document.getElementById('link-excel-import-btn').addEventListener('click', importLinksFromExcel);
    document.getElementById('link-text-import-btn').addEventListener('click', importLinksFromText);
    document.getElementById('link-txt-import-btn').addEventListener('click', importLinksFromTxt);
    document.getElementById('start-convert-btn').addEventListener('click', startConvert);
    document.getElementById('stop-convert-btn').addEventListener('click', stopConvert);
    document.getElementById('clear-links-btn').addEventListener('click', clearLinkConvertList);
    document.getElementById('export-links-btn').addEventListener('click', exportLinkConvertList);
    
    renderLinkConvertList();
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
    const accepted = await showDisclaimerModal();
    if (!accepted) {
        await ipcRenderer.invoke('quit-app');
        return;
    }

    initNavigation();
    initAccountPage();
    initSettingsPage();
    initCollectPage();
    initBloggerListPage();
    initLinkConvertPage();
    initLicensePage();
    
    // 加载会员等级
    const info = await ipcRenderer.invoke('get-license-info');
    if (info) {
        currentMemberLevel = info.member_level;
    }
});
