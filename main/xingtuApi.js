/**
 * 星图平台API模块
 * 实现博主信息采集的所有API调用
 */

const https = require('https');

const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 20
});

// ==================== HTTP 请求函数 ====================

function makeRequest(options, postData = null) {
    return new Promise((resolve) => {
        console.log(`[xingtuApi] 请求: ${options.method} ${options.path}`);
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`[xingtuApi] 响应状态: ${res.statusCode}, 数据长度: ${data.length}`);
                if (data.length < 500) {
                    console.log(`[xingtuApi] 响应内容: ${data}`);
                }
                resolve({ statusCode: res.statusCode, data });
            });

            res.on('aborted', () => {
                console.error('[xingtuApi] 响应被中断(aborted)');
                resolve({ statusCode: 0, error: '响应被中断' });
            });
        });
        
        req.on('error', (e) => {
            console.error(`[xingtuApi] 请求错误: ${e.message}`);
            resolve({ statusCode: 0, error: e.message });
        });
        
        req.on('timeout', () => {
            console.error(`[xingtuApi] 请求超时`);
            req.destroy();
            resolve({ statusCode: 0, error: '请求超时' });
        });

        if (options && options.timeout) {
            req.setTimeout(options.timeout);
        }
        
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

function getRequestOptions(path, cookies) {
    return {
        hostname: 'www.xingtu.cn',
        port: 443,
        path: path,
        method: 'GET',
        agent: httpsAgent,
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9',
            'agw-js-conv': 'str',
            'referer': 'https://www.xingtu.cn/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'Cookie': cookies,
            'Host': 'www.xingtu.cn',
            'Connection': 'keep-alive',
            'x-login-source': '1'
        },
        timeout: 30000
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 通用重试包装器
 * @param {Function} apiCall - 要执行的API调用函数
 * @param {string} apiName - API名称（用于日志）
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise} - API调用结果
 */
async function withRetry(apiCall, apiName, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const base = 800;
                const delay = Math.min(15000, base * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
                console.log(`[${apiName}] 重试 ${attempt}/${maxRetries}，等待 ${delay}ms...`);
                await sleep(delay);
            }
            const result = await apiCall();
            if (result.success) {
                return result;
            }
            // 如果返回失败但不是异常，记录错误并继续重试
            lastError = result.message || '未知错误';
            if (attempt < maxRetries) {
                console.log(`[${apiName}] 请求失败: ${lastError}，准备重试...`);
            }
        } catch (e) {
            lastError = e.message;
            console.error(`[${apiName}] 异常: ${e.message}`);
            if (attempt >= maxRetries) {
                return { success: false, message: lastError };
            }
        }
    }
    console.error(`[${apiName}] 已重试${maxRetries}次，最终失败: ${lastError}`);
    return { success: false, message: lastError };
}

function getPostRequestOptions(path, cookies, postData) {
    const dataStr = JSON.stringify(postData);
    return {
        hostname: 'www.xingtu.cn',
        port: 443,
        path: path,
        method: 'POST',
        agent: httpsAgent,
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9',
            'agw-js-conv': 'str',
            'content-type': 'application/json',
            'referer': 'https://www.xingtu.cn/ad/creator/market',
            'origin': 'https://www.xingtu.cn',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'Cookie': cookies,
            'Host': 'www.xingtu.cn',
            'Connection': 'keep-alive',
            'x-login-source': '1',
            'Content-Length': Buffer.byteLength(dataStr)
        },
        timeout: 30000
    };
}

/**
 * 通过抖音主页URL搜索获取authorId
 */
async function searchAuthorByDouyinUrl(douyinUrl, cookies) {
    return await withRetry(async () => {
        const path = '/gw/api/gsearch/search_for_author_square';
        const postData = {
            scene_param: {
                platform_source: 1,
                search_scene: 1,
                display_scene: 1,
                task_category: 1,
                marketing_target: 1,
                first_industry_id: 0
            },
            page_param: {
                page: "1",
                limit: "20"
            },
            sort_param: {
                sort_field: { field_name: "score" },
                sort_type: 2
            },
            search_param: {
                seach_type: 2,
                keyword: douyinUrl,
                is_new_nickname_query: true
            }
        };
        
        const options = getPostRequestOptions(path, cookies, postData);
        const dataStr = JSON.stringify(postData);
        
        const response = await makeRequest(options, dataStr);
        if (response.statusCode === 0) {
            return { success: false, message: response.error || '网络请求失败' };
        }
        if (response.statusCode !== 200) {
            return { success: false, message: `HTTP错误: ${response.statusCode}` };
        }
        
        const parsed = safeJsonParse(response.data, 'searchAuthorByDouyinUrl');
        if (!parsed.success) {
            return { success: false, message: parsed.error };
        }
        
        const result = parsed.result;
        if (result.base_resp && result.base_resp.status_code === 0) {
            const authors = result.authors || [];
            if (authors.length > 0) {
                const authorId = authors[0].attribute_datas?.id || authors[0].star_id;
                const nickName = authors[0].attribute_datas?.nick_name || '';
                return {
                    success: true,
                    authorId: authorId,
                    nickName: nickName
                };
            }
            return { success: false, message: '未找到对应的达人' };
        }
        
        return { success: false, message: result.base_resp?.status_message || '搜索失败' };
    }, 'searchAuthorByDouyinUrl', 5);
}

// ==================== 安全JSON解析 ====================

function safeJsonParse(data, apiName) {
    if (!data || data.length === 0) {
        console.error(`[${apiName}] 响应数据为空`);
        return { success: false, error: '响应数据为空' };
    }
    
    try {
        return { success: true, result: JSON.parse(data) };
    } catch (e) {
        console.error(`[${apiName}] JSON解析失败: ${e.message}`);
        console.error(`[${apiName}] 数据前200字符: ${data.substring(0, 200)}`);
        console.error(`[${apiName}] 数据后100字符: ${data.substring(data.length - 100)}`);
        return { success: false, error: `JSON解析失败: ${e.message}` };
    }
}

// ==================== 数据格式化工具函数 ====================

function formatWan(num) {
    if (!num || num === 0) return '0';
    const n = parseFloat(num);
    if (n >= 10000) {
        return (n / 10000).toFixed(1) + 'w';
    }
    return n.toString();
}

function formatPercent(num, decimals = 1) {
    if (!num && num !== 0) return '';
    const n = parseFloat(num);
    return (n * 100).toFixed(decimals) + '%';
}

function formatPercentFromInt(num, decimals = 1) {
    if (!num && num !== 0) return '';
    const n = parseFloat(num);
    return (n / 10).toFixed(decimals) + '%';
}

function formatSeconds(num) {
    if (!num) return '';
    const n = parseFloat(num);
    return (n / 100).toFixed(1) + 's';
}

function formatGender(gender) {
    if (gender === 1) return '男';
    if (gender === 0) return '女';
    return '';
}

// ==================== API 接口函数 ====================

/**
 * 获取博主个人信息
 */
async function getAuthorBaseInfo(authorId, cookies, retryCount = 0) {
    const apiName = 'getAuthorBaseInfo';
    const maxRetries = 3;
    const path = `/gw/api/author/get_author_base_info?o_author_id=${authorId}&platform_source=1&platform_channel=1&recommend=true&need_sec_uid=true&need_linkage_info=true`;
    const options = getRequestOptions(path, cookies);
    
    try {
        console.log(`[${apiName}] 开始请求 authorId=${authorId}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ''}`);
        const response = await makeRequest(options);
        console.log(`[${apiName}] 响应状态码: ${response.statusCode}`);
        
        if (response.statusCode === 200) {
            if (!response.data || response.data.length === 0) {
                // 响应为空时进行重试
                if (retryCount < maxRetries) {
                    const delay = 500 * (retryCount + 1);
                    console.log(`[${apiName}] 响应数据为空，${delay}ms后重试...`);
                    await sleep(delay);
                    return getAuthorBaseInfo(authorId, cookies, retryCount + 1);
                }
                console.error(`[${apiName}] 响应数据为空，已重试${maxRetries}次`);
                return { success: false, message: '响应数据为空' };
            }
            
            let result;
            try {
                result = JSON.parse(response.data);
            } catch (parseErr) {
                console.error(`[${apiName}] JSON解析失败: ${parseErr.message}, 数据前100字符: ${response.data.substring(0, 100)}`);
                return { success: false, message: `JSON解析失败: ${parseErr.message}` };
            }
            
            if (result.base_resp && result.base_resp.status_code === 0) {
                const tagsRelation = result.tags_relation || {};
                let tagsStr = '';
                for (const [key, values] of Object.entries(tagsRelation)) {
                    if (Array.isArray(values)) {
                        tagsStr += `${key}-${values.join(',')}; `;
                    }
                }
                
                console.log(`[${apiName}] 成功获取数据`);
                return {
                    success: true,
                    data: {
                        '达人昵称': result.nick_name || '',
                        '归属地': `${result.province || ''}${result.city || ''}`,
                        '性别': formatGender(result.gender),
                        '抖音ID': result.short_id || '',
                        '抖音主页': result.sec_uid ? `https://www.douyin.com/user/${result.sec_uid}` : '',
                        'MCN机构': result.mcn_name || '',
                        '达人类型': tagsStr.trim(),
                        '内容主题': (result.content_theme_labels || []).join('、')
                    }
                };
            } else {
                console.error(`[${apiName}] API返回错误: ${result.base_resp?.status_message || '未知错误'}`);
            }
        }
        return { success: false, message: '获取博主个人信息失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取博主商业卡片信息
 */
async function getBusinessCardInfo(authorId, cookies) {
    const apiName = 'getBusinessCardInfo';
    const path = `/gw/api/gauthor/author_get_business_card_info?o_author_id=${authorId}`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const parsed = safeJsonParse(response.data, apiName);
            if (!parsed.success) return { success: false, message: parsed.error };
            const result = parsed.result;
            
            if (result.base_resp && result.base_resp.status_code === 0) {
                const cardInfo = result.card_info || {};
                return {
                    success: true,
                    data: {
                        '个人介绍': cardInfo.self_intro || '',
                        '粉丝数': cardInfo.follower || '',
                        '微信号': cardInfo.wechat || '',
                        '合作品牌': cardInfo.cooperation_brand || ''
                    }
                };
            }
        }
        return { success: false, message: '获取商业卡片信息失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取月连接用户数
 */
async function getMonthlyLinkCount(authorId, cookies) {
    const apiName = 'getMonthlyLinkCount';
    const path = `/gw/api/data_sp/check_author_display?o_author_id=${authorId}&platform_source=1&platform_channel=1`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const parsed = safeJsonParse(response.data, apiName);
            if (!parsed.success) return { success: false, message: parsed.error };
            const result = parsed.result;
            
            if (result.base_resp && result.base_resp.status_code === 0) {
                return {
                    success: true,
                    data: {
                        '月连接用户数': formatWan(result.link_cnt)
                    }
                };
            }
        }
        return { success: false, message: '获取月连接用户数失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取月涨粉率
 */
async function getMonthlyFansGrowth(authorId, cookies) {
    const apiName = 'getMonthlyFansGrowth';
    const path = `/gw/api/aggregator/get_author_side_base_info?o_author_id=${authorId}`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const parsed = safeJsonParse(response.data, apiName);
            if (!parsed.success) return { success: false, message: parsed.error };
            const result = parsed.result;
            
            if (result.base_resp && result.base_resp.status_code === 0) {
                const rate = parseFloat(result.fans_growth_rate_30d || 0);
                return {
                    success: true,
                    data: {
                        '月涨粉率': (rate * 100).toFixed(2) + '%'
                    }
                };
            }
        }
        return { success: false, message: '获取月涨粉率失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取合作报价
 */
async function getMarketingInfo(authorId, cookies) {
    const apiName = 'getMarketingInfo';
    const path = `/gw/api/author/get_author_marketing_info?o_author_id=${authorId}&platform_source=1&platform_channel=1`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const parsed = safeJsonParse(response.data, apiName);
            if (!parsed.success) return { success: false, message: parsed.error };
            const result = parsed.result;
            if (result.base_resp && result.base_resp.status_code === 0) {
                const priceInfo = result.price_info || [];
                let price1_20 = '', price21_60 = '', price60plus = '';
                const otherPrices = [];
                
                for (const item of priceInfo) {
                    if (!item.enable) continue;
                    if (item.desc === '1-20s视频') {
                        price1_20 = item.price || '';
                    } else if (item.desc === '21-60s视频') {
                        price21_60 = item.price || '';
                    } else if (item.desc === '60s以上视频') {
                        price60plus = item.price || '';
                    } else if (item.price) {
                        otherPrices.push(`${item.desc}:${item.price}`);
                    }
                }
                
                return {
                    success: true,
                    data: {
                        '行业标签': (result.industry_tags || []).join('、'),
                        '报价-1-20s视频': price1_20,
                        '报价-21-60s视频': price21_60,
                        '报价-60s以上视频': price60plus,
                        '其他报价': otherPrices.join('、')
                    }
                };
            }
        }
        return { success: false, message: '获取合作报价失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取商业能力-传播价值数据
 */
async function getSpreadInfo(authorId, cookies, type, onlyAssign, range) {
    const apiName = 'getSpreadInfo';
    const path = `/gw/api/data_sp/get_author_spread_info?o_author_id=${authorId}&platform_source=1&platform_channel=1&type=${type}&flow_type=0&only_assign=${onlyAssign}&range=${range}`;
    const options = getRequestOptions(path, cookies);
    
    let prefix = '商业能力-传播价值-';
    if (type === 2) {
        prefix += '星图视频-';
    } else {
        prefix += '个人视频-';
    }
    prefix += range === 2 ? '近30天' : '近90天';
    if (onlyAssign) prefix += '-只看指派';
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const parsed = safeJsonParse(response.data, apiName);
            if (!parsed.success) return { success: false, message: parsed.error };
            const result = parsed.result;
            
            if (result.base_resp && result.base_resp.status_code === 0) {
                const playMid = result.item_rate?.play_mid?.value || result.play_mid || 0;
                return {
                    success: true,
                    data: {
                        [`${prefix}-播放量中位数`]: formatWan(playMid),
                        [`${prefix}-完播率`]: formatPercentFromInt(result.play_over_rate?.value),
                        [`${prefix}-互动率`]: formatPercentFromInt(result.interact_rate?.value),
                        [`${prefix}-发布作品`]: result.item_num || '',
                        [`${prefix}-平均时长`]: formatSeconds(result.avg_duration),
                        [`${prefix}-平均点赞`]: result.like_avg || '',
                        [`${prefix}-平均评论`]: result.comment_avg || '',
                        [`${prefix}-平均转发`]: result.share_avg || ''
                    }
                };
            }
        }
        return { success: false, message: '获取传播价值数据失败' };
    } catch (e) {
        console.error(`[${apiName}] 异常: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 获取效果预估
 */
async function getCommerceSpreadInfo(authorId, cookies) {
    const path = `/gw/api/aggregator/get_author_commerce_spread_info?o_author_id=${authorId}`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                return {
                    success: true,
                    data: {
                        '效果预估-预期CPM-1-20s视频': parseFloat(result.cpm_1_20 || 0).toFixed(2),
                        '效果预估-预期CPE-1-20s视频': parseFloat(result.cpe_1_20 || 0).toFixed(2),
                        '效果预估-预期CPM-20-60s视频': parseFloat(result.cpm_20_60 || 0).toFixed(2),
                        '效果预估-预期CPE-20-60s视频': parseFloat(result.cpe_20_60 || 0).toFixed(2),
                        '效果预估-预期CPM-60s以上视频': parseFloat(result.cpm_60 || 0).toFixed(2),
                        '效果预估-预期CPE-60s以上视频': parseFloat(result.cpe_60 || 0).toFixed(2),
                        '效果预估-预期播放量': formatWan(result.vv),
                        '效果预估-爆文率': (parseFloat(result.platform_hot_rate || 0) * 100) + '%'
                    }
                };
            }
        }
        return { success: false, message: '获取效果预估失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取种草价值
 */
async function getSeedInfo(authorId, cookies, range) {
    const path = `/gw/api/aggregator/get_author_commerce_seed_base_info?o_author_id=${authorId}&range=${range}`;
    const options = getRequestOptions(path, cookies);
    const prefix = `种草价值-近${range}天`;
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                return {
                    success: true,
                    data: {
                        [`${prefix}-看后搜次数`]: result.avg_search_after_view_cnt || '',
                        [`${prefix}-看后搜率`]: result.avg_search_after_view_rate || '',
                        [`${prefix}-A3增长数`]: result.avg_a3_incr_cnt || '',
                        [`${prefix}-进店成本`]: result.star_overflow_avg_enter_shop_cost || ''
                    }
                };
            }
        }
        return { success: false, message: '获取种草价值失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取转化价值-星图短视频
 */
async function getConvertAbility(authorId, cookies, range) {
    const path = `/gw/api/data_sp/get_author_convert_ability?o_author_id=${authorId}&platform_source=1&platform_channel=1&industry_id=0&range=${range}`;
    const options = getRequestOptions(path, cookies);
    const rangeMap = { 1: '近7天', 2: '近30天', 3: '近90天' };
    const prefix = `转化价值-星图短视频-${rangeMap[range] || ''}`;
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                return {
                    success: true,
                    data: {
                        [`${prefix}-相关视频数`]: result.related_video_cnt?.value || '',
                        [`${prefix}-播放中位数`]: formatWan(result.video_vv_median?.value),
                        [`${prefix}-组件点击量`]: result.component_click_cnt_range || '',
                        [`${prefix}-组件点击率`]: result.component_click_rate_range || '',
                        [`${prefix}-CPC`]: result.related_cpc_range || '',
                        [`${prefix}-带货商品数`]: result.rec_product_cnt?.value || '',
                        [`${prefix}-平均销售额`]: result.avg_sales_amount_range || '',
                        [`${prefix}-带货商品价格`]: result.rec_product_price_range || '',
                        [`${prefix}-GPM`]: result.gpm_range || ''
                    }
                };
            }
        }
        return { success: false, message: '获取转化价值失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取转化价值-全部带货数据
 */
async function getEcomStat(authorId, cookies, timePeriod) {
    const path = `/gw/api/aggregator/get_author_video_live_linkage_stat?star_author_id=${authorId}&time_period=${timePeriod}`;
    const options = getRequestOptions(path, cookies);
    const prefix = `转化价值-全部带货数据-近${timePeriod}天`;
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const ecomStat = result.ecom_stat || {};
                return {
                    success: true,
                    data: {
                        [`${prefix}-成交GMV`]: ecomStat.gmv_range || '',
                        [`${prefix}-成交订单数`]: ecomStat.pay_cnt_range || '',
                        [`${prefix}-成交客单价`]: ecomStat.atv_range || '',
                        [`${prefix}-达人带货等级`]: (ecomStat.author_level || '').replace(/"/g, ''),
                        [`${prefix}-直播场次`]: ecomStat.ecom_live_cnt || '',
                        [`${prefix}-直播天数`]: ecomStat.ecom_live_days || '',
                        [`${prefix}-直播间曝光次数`]: formatWan(ecomStat.ecom_live_watch_cnt),
                        [`${prefix}-直播间观看人数`]: formatWan(ecomStat.ecom_live_watch_ucnt),
                        [`${prefix}-直播间观众平均看播次数`]: ecomStat.ecom_live_watch_apv || '',
                        [`${prefix}-单小时直播间曝光次数`]: formatWan(ecomStat.ecom_live_show_cnt_ah),
                        [`${prefix}-GPM`]: ecomStat.gpm_range || ''
                    }
                };
            }
        }
        return { success: false, message: '获取全部带货数据失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取最新视频表现
 */
async function getLatestVideos(authorId, cookies, onlyAssign) {
    const path = `/gw/api/author/get_author_show_items_v2?o_author_id=${authorId}&platform_channel=1&platform_source=1&limit=10&only_assign=${onlyAssign}&flow_type=0`;
    const options = getRequestOptions(path, cookies);
    const prefix = onlyAssign ? '创作能力-最新视频-只看指派' : '创作能力-最新视频';
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const allItems = [...(result.latest_item_info || []), ...(result.latest_star_item_info || [])];
                const personalItems = result.latest_item_info || [];
                const starItems = result.latest_star_item_info || [];
                
                const calcStats = (items, field) => {
                    if (items.length === 0) return { min: 0, max: 0, avg: 0 };
                    const values = items.map(i => i[field] || 0);
                    return {
                        min: Math.min(...values),
                        max: Math.max(...values),
                        avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length)
                    };
                };
                
                const data = {};
                for (const [label, items] of [['全部', allItems], ['个人视频', personalItems], ['星图视频', starItems]]) {
                    for (const field of ['play', 'like', 'comment', 'share']) {
                        const fieldName = { play: '播放量', like: '点赞量', comment: '评论量', share: '转发量' }[field];
                        const stats = calcStats(items, field);
                        data[`${prefix}-${label}-${fieldName}`] = `最低:${stats.min} 最高:${stats.max} 平均:${stats.avg}`;
                    }
                }
                
                return { success: true, data };
            }
        }
        return { success: false, message: '获取最新视频表现失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取内容类型分析
 */
async function getContentTypeAnalysis(authorId, cookies) {
    const path = `/gw/api/data_sp/author_video_distribution?o_author_id=${authorId}&platform_source=1&platform_channel=1`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const distribution = result.video_content_distribution || [];
                const contentStr = distribution.map(item => 
                    `${item.name}(${(item.proportion * 100).toFixed(0)}%)`
                ).join('、');
                
                return {
                    success: true,
                    data: {
                        '创作能力-内容类型分析': contentStr
                    }
                };
            }
        }
        return { success: false, message: '获取内容类型分析失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取热词分析-评论热词
 */
async function getCommentHotWords(authorId, cookies) {
    const path = `/gw/api/data/get_author_hot_comment_tokens?author_id=${authorId}&num=10&without_emoji=true`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const tokens = result.hot_comment_tokens || [];
                const hotWordsStr = tokens.map(item => 
                    `${item.comment_token}(${item.hot_rate})`
                ).join('、');
                
                return {
                    success: true,
                    data: {
                        '创作能力-热词分析-评论热词': hotWordsStr
                    }
                };
            }
        }
        return { success: false, message: '获取评论热词失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取热词分析-内容热词
 */
async function getContentHotWords(authorId, cookies) {
    const path = `/gw/api/gauthor/get_author_content_hot_keywords?author_id=${authorId}&keyword_type=0`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const distribution = result.keyword_item_distribution || {};
                const hotWordsStr = Object.entries(distribution).map(([k, v]) => `${k}(${v})`).join('、');
                
                return {
                    success: true,
                    data: {
                        '创作能力-热词分析-内容热词': hotWordsStr
                    }
                };
            }
        }
        return { success: false, message: '获取内容热词失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取定制短剧题材分析
 */
async function getPlayletTheme(authorId, cookies) {
    const path = `/gw/api/aggregator/get_author_playlet_theme_distribution?star_author_id=${authorId}`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const themeDistribution = result.theme_distribution || {};
                const total = Object.values(themeDistribution).reduce((a, b) => a + parseInt(b), 0);
                const themeStr = Object.entries(themeDistribution).map(([k, v]) => {
                    const percent = total > 0 ? ((parseInt(v) / total) * 100).toFixed(1) : 0;
                    return `${k}(${percent}%)`;
                }).join('、');
                
                const personalDistribution = result.content_personal_distribution || {};
                const keywordsStr = Object.keys(personalDistribution).join('、');
                
                return {
                    success: true,
                    data: {
                        '创作能力-定制短剧题材分析': themeStr,
                        '创作能力-定制短剧题材关键词': keywordsStr
                    }
                };
            }
        }
        return { success: false, message: '获取定制短剧题材分析失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

// 行业ID到名称的映射（完整版）
const INDUSTRY_MAP = {
    // 一级行业
    '1901': '3C及电器', '1903': '食品饮料', '1904': '服装配饰', '1905': '医药健康',
    '1906': '商务服务', '1907': '本地服务', '1908': '房地产', '1909': '家居建材',
    '1910': '教育培训', '1911': '出行旅游', '1912': '社会公共', '1913': '游戏',
    '1914': '零售', '1915': '交通工具', '1916': '汽车', '1917': '农林牧畜渔',
    '1918': '化工及能源', '1919': '电子电工', '1920': '机械设备', '1921': '文体娱乐',
    '1922': '传媒资讯', '1923': '物流业', '1924': '通信', '1925': '金融业',
    '1927': '餐饮服务', '1928': '工具类软件', '1929': '招商加盟', '1930': '美妆',
    '1931': '母婴宠物', '1933': '日化', '1934': '实体书籍', '1935': '社交通讯',
    '1936': '医疗机构',
    // 二级行业 - 3C及电器
    '190101': '消费类电子产品', '190103': '其他3C及电器', '190104': '手机', '190106': '电脑',
    '190108': '3C及电器电商', '190109': '3C及电器线下零售', '190110': '小家电', '190111': '家电配件',
    '190112': '大家电', '190113': '3C数码配件', '190114': '电子教育设备',
    // 二级行业 - 食品饮料
    '190206': '烟', '190215': '烟酒电商', '190216': '烟酒线下零售', '190301': '零食/坚果/特产',
    '190302': '饮料冲调', '190303': '乳制品及乳制品饮料', '190304': '粮油米面/南北干货/调味品',
    '190305': '生鲜', '190307': '其他食用初级农产品', '190309': '其他食品饮料', '190310': '酒',
    '190311': '食品饮料（非生鲜）电商', '190312': '食品饮料（非生鲜）线下零售', '190313': '生鲜电商',
    '190314': '生鲜线下零售', '190315': '茶叶', '190317': '膳食营养品', '190318': '传统滋补营养品',
    // 二级行业 - 服装配饰
    '190409': '其他服装配饰', '190410': '服装配饰电商', '190411': '服装配饰线下零售', '190412': '内衣裤袜',
    '190416': '奢侈品', '190417': '珠宝玉石', '190418': '钟表类', '190419': '男鞋', '190420': '童鞋',
    '190421': '箱包', '190422': '女鞋', '190423': '男装', '190424': 'cosplay/二次元服饰',
    '190425': '女装', '190426': '运动服/休闲服装/运动鞋', '190427': '童装', '190428': '服饰配件', '190429': '时尚配饰',
    // 二级行业 - 医药健康
    '190503': '医疗器械', '190504': '药品', '190505': '保健品-国内', '190506': '医疗周边服务',
    '190507': '其他医疗', '190508': '医疗综合服务平台', '190509': '兽药', '190510': '网上药店/医药电商',
    '190511': '药店/医药线下零售', '190512': '保健品-跨境', '190513': '美容美体医疗器械', '190515': '计生用品',
    // 二级行业 - 商务服务
    '190601': '安全安保', '190602': '传媒服务商', '190603': '包装印刷', '190604': '中介服务',
    '190605': '管理咨询', '190606': '广告服务', '190607': '会展服务', '190608': '设计',
    '190609': '会计税务', '190611': '人力资源服务', '190612': '其他商务服务', '190613': '代运营服务',
    '190615': '个人经济纠纷咨询', '190616': '贷款逾期咨询', '190617': '综合法律服务', '190618': '其他法律服务',
    // 二级行业 - 本地服务
    '190701': '生活服务综合平台', '190702': '便民服务', '190703': '家政服务', '190707': '回收买卖',
    '190708': '租赁服务', '190710': '婚恋服务', '190711': '配送服务', '190712': '移民服务',
    '190713': '情感咨询', '190714': '其他本地服务', '190715': '结婚服务', '190716': '婚嫁平台',
    '190717': '起名测算', '190718': '养老服务', '190719': '洗浴按摩', '190720': '孕产服务',
    '190721': '婚庆摄影', '190722': '孕婴童摄影', '190723': '快照', '190724': '印刷写真',
    '190725': '美发', '190726': '美甲美睫', '190727': '补发/织发定制', '190728': '纹眉纹绣',
    '190729': '皮肤管理', '190730': '美体',
    // 二级行业 - 房地产
    '190801': '房地产开发商', '190803': '物业管理公司', '190805': '其他房地产',
    '190806': '房地产综合服务平台', '190807': '房地产分销商/渠道机构',
    // 二级行业 - 家居建材
    '190901': '家装主材', '190904': '家具', '190906': '其他家居建材', '190907': '家居百货',
    '190909': '家装辅材', '190913': '家居建材线下零售', '190914': '家饰', '190917': '家装平台',
    '190919': '家装灯饰光源', '190920': '家用五金', '190921': '床上用品', '190922': '居家布艺',
    '190923': '家用电工', '190924': '装修装饰设计', '190925': '防水补漏', '190926': '轻钢别墅设计和建造业务', '190927': '其他工程服务',
    // 二级行业 - 教育培训
    '191001': '幼儿教育', '191002': '中小学教育', '191003': '学历教育', '191004': '语言及留学',
    '191005': '兴趣培训', '191006': '职业技能', '191007': '企业管理培训', '191008': '特殊人群教育',
    '191009': '职业资格考证培训', '191010': '其他教育培训', '191011': '新媒体运营培训',
    '191012': '理财培训', '191013': '智能教育', '191014': '学习卡', '191015': '冬令营/夏令营/研学游', '191016': '中医健康养生培训',
    // 二级行业 - 出行旅游
    '191101': '景点', '191102': '酒店住宿', '191103': 'OTA（online travel Agent）', '191104': '旅行社',
    '191105': '航空公司', '191106': '公路客运公司', '191107': '邮轮', '191108': '商旅票务代理',
    '191110': '其他出行旅游', '191111': '外旅局', '191112': '汽车租赁', '191113': '打车/专车/接机',
    '191114': '自行车/非机动车租赁', '191115': '公共交通票务',
    // 二级行业 - 社会公共
    '191201': '政府政务文化旅游', '191202': '社会组织', '191204': '宗教', '191205': '其他社会公共',
    '191206': '政府政务科教卫生', '191207': '政府政务环境安全',
    // 二级行业 - 游戏
    '191301': '休闲游戏', '191303': '角色扮演', '191305': '体育竞技', '191308': 'MOBA',
    '191309': '其他游戏', '191310': '射击游戏', '191311': '动作游戏', '191312': 'SLG',
    '191313': '塔防游戏', '191314': '模拟经营', '191315': '卡牌游戏', '191316': '音乐游戏',
    '191317': '游戏平台', '191318': '游戏助手/加速器', '191319': '棋牌捕鱼', '191320': '狼人杀/剧本杀', '191321': '传统棋类游戏',
    // 二级行业 - 零售
    '191401': '综合类2B电商', '191402': '垂直类2B电商', '191403': '综合类2C电商',
    '191404': '跨境类2C电商', '191406': '综合类线下零售', '191408': '其他零售',
    // 二级行业 - 交通工具
    '191501': '飞机厂商', '191502': '船舶厂商', '191503': '摩托车厂商', '191504': '非机动车厂商',
    '191505': '功能性车辆厂商', '191506': '其他交通工具', '191507': '交通工具后市场',
    '191508': '摩托车经销商', '191509': '非机动车经销商',
    // 二级行业 - 汽车
    '191601': '汽车厂商', '191602': '汽车经销商', '191603': '二手车线下零售', '191604': '汽车后市场',
    '191605': '其他汽车', '191606': '汽车综合服务平台', '191607': '新车线下零售', '191608': '汽车周边服务',
    // 二级行业 - 农林牧畜渔
    '191701': '农业', '191702': '林业', '191703': '渔业', '191704': '畜牧业',
    '191705': '农林服务', '191706': '畜牧饲料/添加剂', '191707': '农用物资', '191708': '其他农林牧畜渔',
    // 二级行业 - 化工及能源
    '191801': '化工制品', '191803': '危险化学品', '191804': '食品化工材料', '191805': '化工其它',
    '191806': '燃料能源', '191807': '电力能源', '191808': '新能源', '191809': '矿产资源',
    '191810': '污染处理', '191811': '废旧回收', '191812': '节能', '191813': '其他化工及能源',
    // 二级行业 - 电子电工
    '191901': '电子器件', '191902': '仪器仪表', '191903': '电工电气', '191904': '电工机械', '191905': '其他电子电工',
    // 二级行业 - 机械设备
    '192001': '通用机械设备', '192002': '农林机械', '192003': '矿产机械', '192004': '建筑工程机械',
    '192005': '化工机械', '192006': '木材石材加工机械', '192007': '机床机械', '192008': '商用设备',
    '192009': '基础机械', '192010': '工具配件', '192011': '食品机械', '192013': '清洁通风设备',
    '192014': '其他机械设备', '192015': '机械设备线下零售',
    // 二级行业 - 文体娱乐
    '192101': '演出票务及周边', '192102': '文化艺术收藏品', '192103': '文具玩具礼品', '192104': '乐器',
    '192105': '室内娱乐', '192106': '运动健身', '192107': '体育用品', '192108': '户外用品',
    '192109': '体育赛事及场馆', '192111': '彩票', '192113': '户外娱乐', '192114': '其他文体娱乐',
    '192116': '文体娱乐线下零售', '192117': '潮玩盲盒电商', '192118': '其他文体娱乐电商',
    // 二级行业 - 传媒资讯
    '192201': '电视台', '192202': '广播台', '192203': '影视综艺音像制作', '192204': '数字版权',
    '192208': '网络视听', '192209': '其他传媒资讯', '192211': '资讯', '192212': '在线小说', '192213': '短剧',
    // 二级行业 - 物流业
    '192301': '快递物流', '192302': '货运代理', '192303': '特殊运输', '192304': '物流基础设施', '192305': '其他物流业',
    // 二级行业 - 通信
    '192401': '电信运营商', '192402': '虚拟运营商', '192403': '通信设备', '192404': '其他通信',
    // 二级行业 - 金融业
    '192501': '银行业', '192502': '证券业', '192503': '保险业', '192506': '拍卖典当', '192508': '基金',
    '192509': '征信机构', '192511': '其他金融业', '192513': '另类投资', '192514': '综合金融平台',
    '192515': '金融理财培训', '192516': '期货', '192518': '消费金融', '192604': '贷款服务',
    '192608': '第三方支付', '192611': '金融门户网站',
    // 二级行业 - 餐饮服务
    '192701': '餐厅', '192702': '饮品', '192703': '其他餐饮服务',
    // 二级行业 - 工具类软件
    '192801': '软件工具', '192802': '多媒体处理', '192804': '实用工具', '192805': '其他工具类软件',
    // 二级行业 - 招商加盟
    '192901': '招商加盟联展平台', '192902': '生活用品加盟', '192903': '生活服务加盟', '192904': '服装配饰加盟',
    '192905': '美容美发加盟', '192906': '室内娱乐加盟', '192907': '教育培训加盟', '192908': '酒店加盟',
    '192909': '餐食加盟', '192911': '房产家居建材加盟', '192912': '食品加盟', '192914': '汽车产品加盟',
    '192915': '互联网软件加盟', '192918': '其他招商加盟', '192919': '减肥加盟', '192920': '饮品烘焙加盟',
    '192921': '保健品加盟', '192922': '酒加盟', '192924': '商务服务加盟', '192925': '大健康代加工招商',
    // 二级行业 - 美妆
    '190203': '高档化妆品', '190219': '美妆工具', '193001': '化妆品线下零售', '193002': '化妆品电商',
    '193003': '美妆特殊化妆品', '193004': '护肤', '193005': '彩妆', '193006': '香水',
    // 二级行业 - 母婴宠物
    '190208': '宠物用品', '190213': '母婴用品电商', '190214': '母婴用品线下零售', '190217': '宠物用品电商',
    '190218': '宠物用品线下零售', '193101': '婴童服装', '193102': '孕产妇用品', '193103': '婴儿玩具',
    '193105': '其他母婴宠物', '193106': '婴童用品', '193107': '宠物食品', '193108': '辅食/营养品/零食',
    '193109': '奶粉', '193110': '婴童尿裤', '193111': '婴童洗护',
    // 二级行业 - 日化
    '190220': '特殊日化用品', '193301': '日化用品线下零售', '193303': '家庭护理品', '193304': '其他日化用品',
    '193305': '日化用品电商', '193306': '日化洗护', '193307': '日化纸品', '193308': '日化口腔', '193309': '日化特殊化妆品',
    // 二级行业 - 实体书籍
    '193401': '考试/教材/教辅/论文', '193402': '儿童读物/童书', '193403': '其他成人类书籍',
    // 二级行业 - 社交通讯
    '193501': '一般社交通讯', '193502': '交友类社交通讯', '193503': '婚恋社交通讯',
    '193504': '其他社交通讯', '193505': '泛娱乐社交通讯',
    // 二级行业 - 医疗机构
    '193601': '医疗美容', '193602': '植发机构', '193603': '综合医院', '193604': '中医院/中医馆',
    '193605': '体检服务', '193606': '康复医院', '193607': '妇幼医院', '193608': '口腔医院',
    '193609': '眼科医院', '193610': '专科医疗机构', '193611': '兽类医院/诊所', '193612': '心理咨询', '193613': '其他医疗机构'
};

/**
 * 获取履约能力
 */
async function getContractInfo(authorId, cookies, range) {
    const path = `/gw/api/aggregator/get_author_contract_base_info?o_author_id=${authorId}&range=${range}`;
    const options = getRequestOptions(path, cookies);
    const rangeMap = { 30: '近30天', 90: '近90天' };
    const prefix = `履约能力-${rangeMap[range] || ''}`;
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                let industryCount = 0;
                let orderAnalysis = '';
                let vvAnalysis = '';
                
                try {
                    const orderDistribution = JSON.parse(result.industry_order_distribution || '[]');
                    industryCount = orderDistribution.length;
                    orderAnalysis = orderDistribution.map(item => {
                        const name = INDUSTRY_MAP[item.key] || item.key;
                        const rate = (parseFloat(item.rate) * 100).toFixed(1) + '%';
                        return `${name}(${rate})`;
                    }).join('、');
                } catch (e) {}
                
                try {
                    const vvDistribution = JSON.parse(result.industry_vv_distribution || '[]');
                    vvAnalysis = vvDistribution.map(item => {
                        const name = INDUSTRY_MAP[item.key] || item.key;
                        const rate = (parseFloat(item.rate) * 100).toFixed(1) + '%';
                        return `${name}(${rate})`;
                    }).join('、');
                } catch (e) {}
                
                return {
                    success: true,
                    data: {
                        [`${prefix}-48h消息回复率`]: formatPercent(result.message_reply_rate),
                        [`${prefix}-信用分`]: result.new_credit_score || result.credit_score || '',
                        [`${prefix}-合作行业数`]: industryCount,
                        [`${prefix}-合作商单数`]: result.order_cnt || '',
                        [`${prefix}-进行中任务数`]: result.process_order_cnt || '',
                        [`${prefix}-最大同时进行任务数`]: result.max_process_order_cnt || '',
                        [`${prefix}-合作行业商单分析`]: orderAnalysis,
                        [`${prefix}-合作行业播放量分析`]: vvAnalysis
                    }
                };
            }
        }
        return { success: false, message: '获取履约能力失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取连接用户分布
 */
async function getLinkUserStruct(authorId, cookies) {
    const path = `/gw/api/data_sp/author_link_struct?o_author_id=${authorId}&platform_source=1&platform_channel=1&industry_id=0`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const linkStruct = result.link_struct || {};
                const total = linkStruct['5']?.value || 0;
                const understand = linkStruct['1']?.value || 0;
                const interest = linkStruct['2']?.value || 0;
                const like = linkStruct['3']?.value || 0;
                const follow = linkStruct['4']?.value || 0;
                
                return {
                    success: true,
                    data: {
                        '连接用户-连接用户分布': `总数:${formatWan(total)}、了解:${formatWan(understand)}、兴趣:${formatWan(interest)}、喜欢:${formatWan(like)}、追随:${formatWan(follow)}`
                    }
                };
            }
        }
        return { success: false, message: '获取连接用户分布失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 获取用户画像
 */
async function getAudienceProfile(authorId, cookies) {
    const path = `/gw/api/data_sp/author_audience_distribution?o_author_id=${authorId}&platform_source=1&platform_channel=1&link_type=5`;
    const options = getRequestOptions(path, cookies);
    
    try {
        const response = await makeRequest(options);
        if (response.statusCode === 200) {
            const result = JSON.parse(response.data);
            if (result.base_resp && result.base_resp.status_code === 0) {
                const distributions = result.distributions || [];
                const data = {};
                
                for (const dist of distributions) {
                    const typeDisplay = dist.type_display || '';
                    const list = dist.distribution_list || [];
                    const distStr = list.map(item => `${item.distribution_key}:${item.distribution_value}`).join('、');
                    data[`用户画像-${typeDisplay}`] = distStr;
                }
                
                return { success: true, data };
            }
        }
        return { success: false, message: '获取用户画像失败' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 采集单个博主的所有数据
 * 每个接口都有重试机制，单个接口失败不影响其他接口
 */
async function collectBloggerData(authorId, cookies, selectedFields = {}) {
    console.log(`[collectBloggerData] ========== 开始采集 authorId=${authorId} ==========`);
    console.log(`[collectBloggerData] 选择的字段: ${JSON.stringify(selectedFields)}`);
    
    const allData = { authorId };
    const errors = [];
    
    // 辅助函数：执行API调用并合并结果
    const callApi = async (apiFunc, apiName, ...args) => {
        const result = await withRetry(() => apiFunc(...args), apiName);
        if (result.success && result.data) {
            Object.assign(allData, result.data);
        } else if (!result.success) {
            errors.push(`${apiName}: ${result.message || '未知错误'}`);
        }
        await sleep(80);
        return result;
    };
    
    // 必采字段
    console.log(`[collectBloggerData] 1. 获取博主个人信息...`);
    await callApi(getAuthorBaseInfo, 'getAuthorBaseInfo', authorId, cookies);
    
    console.log(`[collectBloggerData] 2. 获取商业卡片信息...`);
    await callApi(getBusinessCardInfo, 'getBusinessCardInfo', authorId, cookies);
    
    console.log(`[collectBloggerData] 3. 获取月连接用户数...`);
    await callApi(getMonthlyLinkCount, 'getMonthlyLinkCount', authorId, cookies);
    
    console.log(`[collectBloggerData] 4. 获取月涨粉率...`);
    await callApi(getMonthlyFansGrowth, 'getMonthlyFansGrowth', authorId, cookies);
    
    console.log(`[collectBloggerData] 5. 获取合作报价...`);
    await callApi(getMarketingInfo, 'getMarketingInfo', authorId, cookies);
    
    // 可选字段
    if (selectedFields['spread-info']) {
        for (const [type, onlyAssign, range] of [[2, true, 2], [2, true, 3], [2, false, 2], [2, false, 3], [1, false, 2], [1, false, 3]]) {
            await callApi(getSpreadInfo, `getSpreadInfo-${type}-${onlyAssign}-${range}`, authorId, cookies, type, onlyAssign, range);
        }
    }
    
    if (selectedFields['effect-estimate']) {
        await callApi(getCommerceSpreadInfo, 'getCommerceSpreadInfo', authorId, cookies);
    }
    
    if (selectedFields['seed-value']) {
        for (const range of [30, 90]) {
            await callApi(getSeedInfo, `getSeedInfo-${range}`, authorId, cookies, range);
        }
    }
    
    if (selectedFields['convert-ability']) {
        for (const range of [1, 2, 3]) {
            await callApi(getConvertAbility, `getConvertAbility-${range}`, authorId, cookies, range);
        }
    }
    
    if (selectedFields['ecom-stat']) {
        for (const period of [7, 30]) {
            await callApi(getEcomStat, `getEcomStat-${period}`, authorId, cookies, period);
        }
    }
    
    if (selectedFields['latest-videos']) {
        for (const onlyAssign of [false, true]) {
            await callApi(getLatestVideos, `getLatestVideos-${onlyAssign}`, authorId, cookies, onlyAssign);
        }
    }
    
    if (selectedFields['content-type']) {
        await callApi(getContentTypeAnalysis, 'getContentTypeAnalysis', authorId, cookies);
    }
    
    if (selectedFields['hot-words']) {
        await callApi(getCommentHotWords, 'getCommentHotWords', authorId, cookies);
        await callApi(getContentHotWords, 'getContentHotWords', authorId, cookies);
    }
    
    if (selectedFields['playlet-theme']) {
        await callApi(getPlayletTheme, 'getPlayletTheme', authorId, cookies);
    }
    
    if (selectedFields['contract-info']) {
        for (const range of [30, 90]) {
            await callApi(getContractInfo, `getContractInfo-${range}`, authorId, cookies, range);
        }
    }
    
    if (selectedFields['link-user']) {
        await callApi(getLinkUserStruct, 'getLinkUserStruct', authorId, cookies);
    }
    
    if (selectedFields['audience-profile']) {
        await callApi(getAudienceProfile, 'getAudienceProfile', authorId, cookies);
    }
    
    // 添加错误信息到数据中，方便导出时查看
    if (errors.length > 0) {
        allData['采集错误'] = errors.join('; ');
    }
    
    console.log(`[collectBloggerData] 采集完成，成功字段: ${Object.keys(allData).length - 1}，错误数: ${errors.length}`);
    
    return {
        success: true, // 总是返回成功，即使有部分接口失败
        data: allData,
        errors: errors,
        hasErrors: errors.length > 0
    };
}

module.exports = {
    collectBloggerData,
    searchAuthorByDouyinUrl,
    getAuthorBaseInfo,
    getBusinessCardInfo,
    getMonthlyLinkCount,
    getMonthlyFansGrowth,
    getMarketingInfo,
    getSpreadInfo,
    getCommerceSpreadInfo,
    getSeedInfo,
    getConvertAbility,
    getEcomStat,
    getLatestVideos,
    getContentTypeAnalysis,
    getCommentHotWords,
    getContentHotWords,
    getPlayletTheme,
    getContractInfo,
    getLinkUserStruct,
    getAudienceProfile
};
