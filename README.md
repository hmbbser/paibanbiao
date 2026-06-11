# 甜排班

可爱高级风账号租借排班系统，支持管理员和普通用户同站点登录、账号管理、用户管理、出租时间线、冲突检测、审计日志、完整导入导出，以及桌面/iPad/iPhone 三端适配。

## Docker 部署

```bash
git clone https://github.com/hmbbser/paibanbiao.git
cd paibanbiao
docker compose up -d --build
```

打开：

```text
http://localhost:8080
```

首次访问会进入安装向导，创建第一个管理员账号。

如果服务器只有旧版 `docker-compose`，也可以运行：

```bash
docker-compose up -d --build
```

## 本地开发

需要本机安装 Node.js 和 npm：

```bash
npm install
npm run dev
```

前端默认运行在 Vite 地址，后端 API 默认运行在 `8080`。

## 功能范围

- 管理员：账号、用户、出租记录、审计日志、完整导入导出。
- 普通用户：查看全部账号信息和出租时间线，只能维护自己创建的出租记录。
- 出租记录：支持预约、出租中、已结束、提前结束、已取消。
- 冲突规则：普通用户禁止重叠预约；管理员可勾选覆盖冲突。
- 完整导出：下载包含系统设置、用户、账号、出租记录、审计日志的 zip 备份。
- 完整导入：管理员上传备份包，全量恢复到另一台服务器；导入前自动生成恢复点。
- 系统设置：管理员可以修改左上角系统名称和浏览器标题。
- 版本更新：管理员可以检测 GitHub 最新版本，并一键拉取代码、重建容器、自动重启。

## 数据持久化

Docker Compose 会把 SQLite 数据库存放在 `schedule-data` volume 中。容器重启不会丢失数据。

## 一键更新说明

后台“设置 -> 版本更新”会读取 GitHub 仓库 `hmbbser/paibanbiao` 的 `package.json` 版本号。

当远程版本高于当前版本时，管理员可以点击“一键更新”。系统会在服务器执行：

```bash
git fetch origin main
git reset --hard origin/main
docker compose up -d --build
```

为了让容器能更新宿主机代码并重启服务，`docker-compose.yml` 已挂载：

- 当前项目目录到 `/opt/cute-schedule`
- Docker socket 到 `/var/run/docker.sock`

请确保服务器上的项目目录是从 GitHub clone 下来的仓库，并且有 `origin` 指向：

```bash
https://github.com/hmbbser/paibanbiao.git
```
