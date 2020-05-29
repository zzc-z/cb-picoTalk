# Running PicoTalk with Apache2

Running PicoTalk as a website requires to run two parts: The actual website (user interface) and the voice call server.
The JavaScript client uses the WebSocket interface to connect to the voice call server. The WebSocket interface
must be accessible over HTTPS as modern browsers require it.
To enable HTTPS a web server such as Apache or Nginx must be used as a reverse-proxy in front of the call server.

Example Apache configuration:
```
<VirtualHost *:80>

        ServerAdmin webmaster@localhost
        ServerName talk.myserver.org
        DocumentRoot /var/www/html/talk.myserver.org/picotalk-static

        # Proxy for the WebSocket.
        # The picoTalk server is listening for WebSocket connections on port 9998.
        RewriteEngine on
        RewriteCond %{HTTP:Upgrade} =websocket [NC]
        RewriteRule /ws           ws://localhost:9998/ws [P,L] # The call server serves an unencrypted websocket.
        RewriteCond %{HTTP:Upgrade} !=websocket [NC]
        RewriteRule /ws           http://localhost:9998/ws [P,L]

        ProxyPassReverse /ws http://localhost:9998/ws

</VirtualHost>
```

Make sure the modules `proxy_http` and `proxy_wstunnel` are enabled.