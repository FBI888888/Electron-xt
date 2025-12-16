# 鉴权服务端部署指南

## 概述

这是一个支持多系统的软件鉴权服务端，目前支持：
- **小红书系统** (xiaohongshu)
- **星图系统** (xingtu)

每个系统支持 **VIP** 和 **SVIP** 两种会员等级。

---

## 快速开始

### 1. 安装依赖

```bash
cd auth-server
npm install
```

### 2. 配置环境变量

复制示例配置文件并修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库和密钥：

```env
# 服务器配置
PORT=3000
NODE_ENV=production

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=auth_system

# JWT密钥 (请修改为随机字符串)
JWT_SECRET=修改为你的密钥
JWT_ADMIN_SECRET=修改为你的管理员密钥

# 加密密钥
ENCRYPTION_KEY=修改为32位随机字符串

# 客户端请求/响应签名密钥 (必须与客户端 main/license.js 的 CLIENT_KEY 保持一致)
# 用于校验客户端请求头 X-Signature，以及服务端响应字段 signature
CLIENT_REQUEST_KEY=修改为随机字符串

# 管理员初始密码
ADMIN_PASSWORD=admin123456
```

### 3. 初始化数据库

确保 MySQL 服务已启动，然后运行：

```bash
npm run init-db
```

或者手动导入 SQL：

```bash
mysql -u root -p < scripts/database.sql
```

### 4. 启动服务

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

### 5. 访问管理后台

打开浏览器访问: `http://localhost:3000/admin`

默认管理员账号:
- 用户名: `admin`
- 密码: `admin123456`

---

## API 接口

### 客户端接口

### 客户端请求签名 (重要)

为防止请求被伪造/篡改，客户端请求必须携带以下头：

- **X-Timestamp**：毫秒时间戳（服务端允许 ±5 分钟）
- **X-Signature**：HMAC-SHA256 签名

签名计算规则：

```
payload = JSON.stringify(body) + '.' + X-Timestamp
X-Signature = HMAC_SHA256(payload, CLIENT_REQUEST_KEY)
```

若缺失或校验失败，服务端返回 `INVALID_SIGNATURE`。

### 服务端响应签名 (重要)

`/api/auth/activate` 与 `/api/auth/verify` 在成功时会返回：

- `data`：业务数据 + `timestamp`
- `signature`：对 `data` 的签名

签名计算规则：

```
signature = HMAC_SHA256(JSON.stringify(data), CLIENT_REQUEST_KEY)
```

客户端需要校验该签名，不通过应视为鉴权失败。

#### 激活激活码
```
POST /api/auth/activate
Content-Type: application/json
X-Timestamp: 时间戳
X-Signature: 请求签名

{
    "license_key": "XXXX-XXXX-XXXX-XXXX",
    "machine_code": "机器码",
    "system_type": "xiaohongshu"
}
```

#### 验证激活状态 (心跳)
```
POST /api/auth/verify
Content-Type: application/json
X-Timestamp: 时间戳
X-Signature: 请求签名

{
    "license_key": "XXXX-XXXX-XXXX-XXXX",
    "machine_code": "机器码",
    "system_type": "xiaohongshu"
}
```

#### 检查激活码状态
```
POST /api/auth/check
Content-Type: application/json
X-Timestamp: 时间戳
X-Signature: 请求签名

{
    "license_key": "XXXX-XXXX-XXXX-XXXX"
}
```

### 管理接口

所有管理接口需要在 Header 中携带 JWT Token:
```
Authorization: Bearer <token>
```

| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/admin/login` | POST | 管理员登录 |
| `/api/admin/licenses` | GET | 获取激活码列表 |
| `/api/admin/licenses/generate` | POST | 生成激活码 |
| `/api/admin/licenses/:id/unbind` | POST | 解绑机器码 |
| `/api/admin/licenses/:id/ban` | POST | 禁用激活码 |
| `/api/admin/licenses/:id/unban` | POST | 启用激活码 |
| `/api/admin/licenses/:id/extend` | POST | 延长有效期 |

---

## 命令行工具

### 生成激活码

```bash
npm run generate-key -- --system xiaohongshu --level SVIP --days 365 --count 10

# 参数说明:
# -s, --system   系统类型: xiaohongshu, xingtu
# -l, --level    会员等级: VIP, SVIP
# -d, --days     有效天数 (1-3650)
# -c, --count    生成数量 (1-100)
# -r, --remark   备注信息
```

---

## 生产部署

### 使用 PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start src/app.js --name auth-server

# 查看状态
pm2 status

# 查看日志
pm2 logs auth-server

# 设置开机自启
pm2 startup
pm2 save
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### HTTPS 配置

强烈建议使用 HTTPS，可使用 Let's Encrypt 免费证书：

```bash
# 安装 certbot
apt install certbot python3-certbot-nginx

# 获取证书
certbot --nginx -d your-domain.com
```

---

## 客户端配置

部署完成后，需要修改客户端的服务器地址。

编辑 `main/license.js`：

```javascript
const AUTH_SERVER = {
    host: 'your-domain.com',  // 修改为你的域名
    port: 443,                 // HTTPS 使用 443
    protocol: 'https'          // 改为 https
};
```

## 版本兼容性 / 发布顺序 (重要)

由于启用了请求/响应签名校验：

- **升级服务端后**，旧客户端如果不带 `X-Signature` 将无法调用鉴权接口。
- **升级客户端后**，旧服务端如果不返回正确的 `signature`，客户端会认为鉴权失败。

建议发布顺序：

1. 先部署服务端（并配置 `.env` 的 `CLIENT_REQUEST_KEY`）
2. 再发布/推送新版客户端

---

## 安全建议

1. **修改默认密码** - 首次登录后立即修改管理员密码
2. **使用 HTTPS** - 生产环境必须使用 HTTPS
3. **修改密钥** - 修改 `.env` 中的所有密钥为随机字符串
4. **数据库安全** - 使用强密码，限制远程访问
5. **定期备份** - 定期备份数据库
6. **监控日志** - 关注异常登录和激活行为

---

## 扩展新系统

如需添加新系统（如：抖音星图）：

1. 在 `src/models/License.js` 中添加系统类型：
```javascript
const SystemType = {
    XHS: 'xiaohongshu',
    XINGTU: 'xingtu',
    DOUYIN: 'douyin'  // 新增
};
```

2. 在管理后台 `public/admin.html` 中添加选项：
```html
<option value="douyin">抖音系统</option>
```

3. 客户端新增对应的 license 模块，设置 `SYSTEM_TYPE = 'douyin'`

---

## 目录结构

```
auth-server/
├── src/
│   ├── app.js              # 主入口
│   ├── config/
│   │   └── database.js     # 数据库配置
│   ├── middleware/
│   │   └── auth.js         # 认证中间件
│   ├── models/
│   │   ├── Admin.js        # 管理员模型
│   │   └── License.js      # 激活码模型
│   ├── routes/
│   │   ├── admin.js        # 管理路由
│   │   └── auth.js         # 鉴权路由
│   └── utils/
│       └── crypto.js       # 加密工具
├── public/
│   └── admin.html          # 管理后台
├── scripts/
│   ├── database.sql        # 数据库脚本
│   ├── init-db.js          # 初始化脚本
│   └── generate-license.js # 激活码生成工具
├── .env.example            # 环境变量示例
├── package.json
└── README.md
```

---

## 许可证

私有软件，未经授权禁止分发。
