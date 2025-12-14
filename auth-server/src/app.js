const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const { testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';  // 绑定所有网卡，允许外部访问

// 安全中间件 (生产环境可启用更多选项)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));

// CORS配置 - 允许所有来源跨域访问
app.use(cors({
    origin: '*',  // 允许所有来源
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Timestamp', 'X-Signature'],
    credentials: false  // 使用 * 时不能使用 credentials
}));

// 处理预检请求
app.options('*', cors());

// 额外的 CORS 头部 (确保兼容性)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Timestamp, X-Signature');
    next();
});

// 解析JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件 (管理后台)
app.use(express.static(path.join(__dirname, '../public')));

// 请求日志
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Auth Server Running',
        timestamp: new Date().toISOString()
    });
});

// 管理后台入口
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 根路径重定向到管理后台
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Not Found'
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error'
    });
});

// 启动服务器
async function startServer() {
    // 测试数据库连接
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
        console.error('⚠️  数据库连接失败，请检查配置');
        console.log('💡 提示: 请确保已运行 npm run init-db 初始化数据库');
    }

    app.listen(PORT, HOST, () => {
        console.log('========================================');
        console.log('🚀 鉴权服务器已启动');
        console.log(`📍 监听地址: ${HOST}:${PORT}`);
        console.log(`🔧 管理后台: http://服务器IP:${PORT}/admin`);
        console.log(`📡 API端点: http://服务器IP:${PORT}/api`);
        console.log('💡 支持跨域访问，无需HTTPS');
        console.log('========================================');
    });
}

startServer();
