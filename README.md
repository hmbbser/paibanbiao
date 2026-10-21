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

本地默认连接真实后端。仅需查看演示界面时，可显式设置 `VITE_DEMO_MODE=true`；演示模式只在开发环境生效。

运行验证：

```bash
npm test
npm run build
```

## 0.2.14 邮件功能

- 登录验证码和重置密码链接合并检查收件箱、垃圾箱，再按接收时间选出查询范围内最新的匹配邮件。支持简繁中文、日语、英语等模板；登录地点不再影响验证码提取。
- 重置链接支持 Steam 的不同语言路径及 Outlook Safe Links 包装，不会把登录提醒中的通用帮助链接当成密码重置链接。
- 账号操作中，“重置密码”后新增“收件箱”。默认包含垃圾箱，可筛选文件夹、搜索、只看未读、翻页、刷新及阅读原格式或纯文本。
- 未读邮件为浅绿色，打开后为灰色。已读状态保存在本系统数据库中，随备份导入导出；不会修改邮箱服务商的已读标记。
- 账号入口按备注中的收件地址筛选；没有该地址时使用绑定邮箱地址。管理员可在邮箱管理直接查看整个邮箱。
- 手动阅读每个文件夹最近 100 封，不受验证码查询时间窗口限制。自动提取沿用设置中的时间范围（默认 10 分钟），查询不到时提示收件地址和时间范围；任一文件夹读取不完整时会报错，避免返回可能过时的验证码。
- Graph 不可用时回退 IMAP，并支持本地化垃圾箱名称。邮件 HTML 经过清理和隔离显示，外部图片默认不加载。

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
