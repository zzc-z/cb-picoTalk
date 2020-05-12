# Running PicoTalk with Apache2

Apache configuration:
```
<VirtualHost *:80>

        ServerAdmin webmaster@localhost
        ServerName talk.myserver.org
        DocumentRoot /var/www/html/talk.myserver.org/picotalk-static

        # Proxy for WebSocket.
        # The picoTalk server is listening for WebSocket connections on port 9998.
        RewriteEngine on
        RewriteCond %{HTTP:Upgrade} =websocket [NC]
        RewriteRule /ws           ws://localhost:9998/ws [P,L]
        RewriteCond %{HTTP:Upgrade} !=websocket [NC]
        RewriteRule /ws           http://localhost:9998/ws [P,L]

        ProxyPassReverse /ws http://localhost:9998/ws

</VirtualHost>
```
