/**
 * 命令行激活码生成工具
 * 运行: npm run generate-key -- --system xiaohongshu --level VIP --days 30 --count 10
 */

const { pool } = require('../src/config/database');
const { generateBatchLicenseKeys } = require('../src/utils/crypto');
require('dotenv').config();

const SystemType = {
    XHS: 'xiaohongshu',
    XINGTU: 'xingtu'
};

const MemberLevel = {
    VIP: 'VIP',
    VVIP: 'VVIP',
    SVIP: 'SVIP'
};

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        system: 'xiaohongshu',
        level: 'VIP',
        days: 30,
        count: 1,
        remark: ''
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--system':
            case '-s':
                options.system = args[++i];
                break;
            case '--level':
            case '-l':
                options.level = args[++i];
                break;
            case '--days':
            case '-d':
                options.days = parseInt(args[++i]);
                break;
            case '--count':
            case '-c':
                options.count = parseInt(args[++i]);
                break;
            case '--remark':
            case '-r':
                options.remark = args[++i];
                break;
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
        }
    }

    return options;
}

function showHelp() {
    console.log(`
激活码生成工具

用法: npm run generate-key -- [选项]

选项:
  -s, --system <type>   系统类型: xiaohongshu, xingtu (默认: xiaohongshu)
  -l, --level <level>   会员等级: VIP, VVIP, SVIP (默认: VIP)
  -d, --days <days>     有效天数 (默认: 30)
  -c, --count <count>   生成数量 (默认: 1, 最大: 100)
  -r, --remark <text>   备注信息
  -h, --help            显示帮助

会员等级说明:
  VIP   - 会员
  VVIP  - 高级会员
  SVIP  - 超级会员

示例:
  npm run generate-key -- -s xiaohongshu -l SVIP -d 365 -c 10
  npm run generate-key -- --system xingtu --level VVIP --days 30 --count 5
`);
}

async function generateLicenses() {
    const options = parseArgs();

    // 验证参数
    if (!Object.values(SystemType).includes(options.system)) {
        console.error(`❌ 无效的系统类型: ${options.system}`);
        console.log('   有效值: xiaohongshu, xingtu');
        process.exit(1);
    }

    if (!Object.values(MemberLevel).includes(options.level)) {
        console.error(`❌ 无效的会员等级: ${options.level}`);
        console.log('   有效值: VIP, VVIP, SVIP');
        process.exit(1);
    }

    if (options.days < 1 || options.days > 3650) {
        console.error('❌ 有效天数必须在 1-3650 之间');
        process.exit(1);
    }

    if (options.count < 1 || options.count > 100) {
        console.error('❌ 生成数量必须在 1-100 之间');
        process.exit(1);
    }

    try {
        console.log('\n========================================');
        console.log('🔑 激活码生成器');
        console.log('========================================');
        console.log(`系统类型: ${options.system}`);
        console.log(`会员等级: ${options.level}`);
        console.log(`有效天数: ${options.days}`);
        console.log(`生成数量: ${options.count}`);
        if (options.remark) {
            console.log(`备注: ${options.remark}`);
        }
        console.log('----------------------------------------\n');

        // 生成激活码
        const keys = generateBatchLicenseKeys(options.count);

        // 构造插入数据
        const values = keys.map(key => [
            key,
            options.system,
            options.level,
            options.days,
            options.remark,
            'unused'
        ]);

        // 批量插入数据库
        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        await pool.execute(
            `INSERT INTO licenses (license_key, system_type, member_level, valid_days, remark, status)
             VALUES ${placeholders}`,
            flatValues
        );

        // 输出生成的激活码
        console.log('✅ 生成的激活码:\n');
        keys.forEach((key, index) => {
            console.log(`  ${index + 1}. ${key}`);
        });

        console.log('\n========================================');
        console.log(`🎉 成功生成 ${options.count} 个激活码`);
        console.log('========================================\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ 生成失败:', error.message);
        process.exit(1);
    }
}

generateLicenses();
