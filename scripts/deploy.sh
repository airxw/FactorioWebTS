#!/bin/bash

set -e

#############################################
# FactorioWebTS 一键部署脚本
# 支持: Ubuntu/Debian/CentOS/RHEL
#############################################

# 配置
APP_NAME="factorio-web-ts"
APP_USER="factorio"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="/opt/${APP_NAME}/data"
CONFIG_DIR="/opt/${APP_NAME}/config"
LOG_DIR="/opt/${APP_NAME}/logs"
SERVICE_NAME="${APP_NAME}.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检查是否为 root
if [[ $EUID -ne 0 ]]; then
   log_error "请使用 root 用户运行此脚本，或使用 sudo"
fi

echo "========================================="
echo "  FactorioWebTS 一键部署脚本"
echo "========================================="

# 1. 检测系统并安装依赖
log_info "检测操作系统..."

if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt-get"
    log_info "检测到 Debian/Ubuntu 系统"
    apt-get update
    apt-get install -y curl git build-essential
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    log_info "检测到 CentOS/RHEL 系统"
    yum install -y curl git gcc gcc-c++ make
elif command -v apk &> /dev/null; then
    PKG_MANAGER="apk"
    log_info "检测到 Alpine 系统"
    apk add --no-cache curl git bash build-base
else
    log_error "不支持的包管理器，请手动安装: curl, git, gcc/g++, make"
fi

# 2. 安装 Node.js 22
log_info "安装 Node.js 22..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ "$NODE_VERSION" == "22" ]]; then
        log_info "Node.js $(node -v) 已安装"
    else
        log_warn "检测到 Node.js $(node -v)，建议使用 Node.js 22"
    fi
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    if [[ "$PKG_MANAGER" == "apt-get" ]]; then
        apt-get install -y nodejs
    elif [[ "$PKG_MANAGER" == "yum" ]]; then
        yum install -y nodejs
    fi
fi

# 3. 创建用户（如不存在）
log_info "创建应用用户..."
if id "${APP_USER}" &>/dev/null; then
    log_info "用户 ${APP_USER} 已存在"
else
    useradd -r -m -s /bin/false ${APP_USER}
    log_info "用户 ${APP_USER} 创建成功"
fi

# 4. 创建目录
log_info "创建目录结构..."
mkdir -p ${APP_DIR}
mkdir -p ${DATA_DIR}
mkdir -p ${CONFIG_DIR}
mkdir -p ${LOG_DIR}

# 5. 部署代码
log_info "部署应用代码..."

# 如果目录已有代码，先备份
if [[ -d "${APP_DIR}/.git" ]]; then
    log_warn "检测到已有代码，正在更新..."
    cd ${APP_DIR}
    sudo -u ${APP_USER} git pull origin dev
else
    # 克隆仓库
    read -p "请输入 Git 仓库地址 (留空则使用 https://github.com/airxw/FactorioWebTS.git): " GIT_REPO
    GIT_REPO=${GIT_REPO:-https://github.com/airxw/FactorioWebTS.git}

    read -p "请输入分支 (留空则使用 dev): " GIT_BRANCH
    GIT_BRANCH=${GIT_BRANCH:-dev}

    rm -rf ${APP_DIR}/*
    git clone --branch ${GIT_BRANCH} ${GIT_REPO} ${APP_DIR}
fi

cd ${APP_DIR}

# 6. 安装依赖
log_info "安装 Node.js 依赖..."
npm ci --production

# 7. 配置环境变量
log_info "配置环境变量..."
ENV_FILE="${APP_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
    cp ${APP_DIR}/.env.example ${ENV_FILE}

    echo ""
    echo "========================================="
    echo "  请配置以下环境变量"
    echo "========================================="

    read -p "JWT_SECRET (至少32字符，留空自动生成): " JWT_SECRET
    if [[ -z "${JWT_SECRET}" ]]; then
        JWT_SECRET=$(openssl rand -base64 32)
        echo "已自动生成密钥: ${JWT_SECRET}"
    fi

    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" ${ENV_FILE}

    # 生成随机端口用于 RCON（可选）
    # read -p "RCON 端口 (默认 27015): " RCON_PORT
    # if [[ ! -z "${RCON_PORT}" ]]; then
    #     echo "RCON_PORT=${RCON_PORT}" >> ${ENV_FILE}
    # fi
else
    log_info "使用已有 .env 配置文件"
fi

# 8. 初始化数据库
log_info "初始化数据库..."
cd ${APP_DIR}
sudo -u ${APP_USER} npm run init:check
if [[ $? -ne 0 ]]; then
    log_warn "数据库未初始化，是否现在初始化？"
    read -p "输入管理员用户名 (默认 admin): " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}
    read -s -p "输入管理员密码: " ADMIN_PASS
    echo ""

    ADMIN_USERNAME=${ADMIN_USER} ADMIN_PASSWORD=${ADMIN_PASS} sudo -u ${APP_USER} npm run init
fi

# 9. 设置权限
log_info "设置文件权限..."
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}
chown -R ${APP_USER}:${APP_USER} ${DATA_DIR}
chown -R ${APP_USER}:${APP_USER} ${LOG_DIR}

# 10. 创建 systemd 服务
log_info "创建 systemd 服务..."
cat > ${SERVICE_FILE} << EOF
[Unit]
Description=FactorioWebTS - Factorio Server Web Panel
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=append:${LOG_DIR}/stdout.log
StandardError=append:${LOG_DIR}/stderr.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

# 11. 启动服务
log_info "启动服务..."
systemctl restart ${SERVICE_NAME}

sleep 2

# 检查服务状态
if systemctl is-active --quiet ${SERVICE_NAME}; then
    log_info "服务启动成功!"
else
    log_error "服务启动失败，请检查日志: journalctl -u ${SERVICE_NAME} -n 50"
fi

# 显示服务状态
echo ""
echo "========================================="
echo "  部署完成!"
echo "========================================="
echo ""
echo "服务状态:"
systemctl status ${SERVICE_NAME} --no-pager | head -10
echo ""
echo "常用命令:"
echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
echo "  重启服务: systemctl restart ${SERVICE_NAME}"
echo "  停止服务: systemctl stop ${SERVICE_NAME}"
echo "  查看应用日志: tail -f ${LOG_DIR}/stdout.log"
echo ""
echo "Web 面板地址: http://$(hostname -I | awk '{print $1}'):3001"
echo "配置文件: ${ENV_FILE}"
echo ""
