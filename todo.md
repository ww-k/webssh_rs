- [] [feat] sftp 编辑/查看功能增加系统编辑器打开
- [] [feat] target 增加备注
- [] [feat] 传输列表 增加删除所有历史记录
- [] [feat] tauri app 支持动态端口启动服务
- [] [feat] 增加ssh连接管理，可以过期连接，关闭连接
- [] [feat] 与sftp联动, support [detect CurrentDir](https://iterm2.com/documentation-escape-codes.html)
  ```
  OSC 1337 ; CurrentDir=[current directory] ST
  "\u001b]1337;CurrentDir=/Users/root\u0007"
  ```
- [] [优化] sftp查看文件功能，点击后，界面响应慢，体验不好。改为立即弹框，并展示loading。
- [] [bug] 文件列表，路径栏上下拉查看目录中没有高亮当前路径的目录
