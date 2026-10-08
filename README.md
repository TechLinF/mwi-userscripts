# MWI 用户脚本

适用于 [Milky Way Idle](https://www.milkywayidle.com/) 国际服和国服的 Tampermonkey 用户脚本。

## 脚本

### MWI 挂牌成交提醒与升级成本

自己的市场卖单或收购单成交时在页面提示，并显示房屋和神龛升级材料成本。

- 当前版本：1.1.12
- [安装脚本](https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-listing-notifier.user.js)
- 数据说明：监听游戏 WebSocket 消息，读取游戏数据和公开市场快照；设置及市场缓存仅保存在浏览器本地，不上传账号数据。
- 致谢：升级成本相关功能基于柆雨的 [Milky Way Idle Guild Assistant](https://github.com/LaYuDr/milky-way-idle-guild-credit-optimizer) 修改，依照 MIT 许可证使用。

### MWI 角色上次在线

在游戏界面列出账号全部角色、距离上次在线的时间和离线收益进度。

- 当前版本：1.2.1
- [安装脚本](https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-character-last-online.user.js)
- 数据说明：使用当前登录状态向游戏官方 API 请求角色列表；离线收益上限设置仅保存在浏览器本地，不上传给作者。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 点击上面的安装文件。
3. 在 Tampermonkey 页面确认安装。

> 安装后 Tampermonkey 会通过 GitHub Raw 地址检查更新。也可以把 `release` 中的两个文件分别发布到 Greasy Fork。

## 隐私

脚本不收集或上传账号数据。脚本只访问游戏页面、游戏官方接口，以及挂牌提醒所需的公开市场快照地址。浏览器中保存的数据可通过删除脚本数据或清理对应站点存储来移除。

## 许可

[MIT](LICENSE)
