- [] [feat] sftp 编辑/查看功能增加系统编辑器打开
- [] [feat] sftp 编辑/查看功能 不使用全app级别的模态框，放到在tab页内或者新建tab页
- [] [feat] 传输列表 增加删除所有历史记录
- [] [feat] 增加ssh连接管理，可以过期连接，关闭连接
- [] [feat] 与sftp联动, support [detect CurrentDir](https://iterm2.com/documentation-escape-codes.html)
  ```
  OSC 1337 ; CurrentDir=[current directory] ST
  "\u001b]1337;CurrentDir=/Users/root\u0007"
  ```
- [] [feat] target list上增加搜索框，可通过名称、用户、host搜索
- [] [feat] target 增加tag，target list上增加通过tag过滤
- [] [bug] 文件列表，路径栏上下拉查看目录中没有高亮当前路径的目录
