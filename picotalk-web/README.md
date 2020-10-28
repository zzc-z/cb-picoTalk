# Hosting PicoTalk Web

Running PicoTalk as a website requires to run two parts: The actual website (user interface) and the voice call server.
The JavaScript client uses the WebSocket interface to connect to the voice call server. The WebSocket interface
must be accessible over HTTPS as modern browsers require it.
To enable HTTPS a web server such as Apache or Nginx must be used as a reverse-proxy in front of the call server.

The following gives hints on how to set up apache and nginx.
Enabling HTTPS with Let's Encrypt certbot should work.

WebSockets need some special treatment in the webserver configuration.

Modern web-browsers will refuse to connect to a non-TLS WebSocket from a HTTPS site. The WebSocket served by picotalk is not TLS encrypted (just picotalk encrypted). This means you have to configure nginx as a reverse proxy which forwards wss://youserver.org/ws (port 443) to http://localhost:9998/ws (this is the running picotalk-server).

## Running PicoTalk with Apache2

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

        # Disable logs for privacy. Otherwise IP addresses are stored.
        ErrorLog /dev/null
        CustomLog /dev/null common

</VirtualHost>
```

Make sure the modules `proxy_http` and `proxy_wstunnel` are enabled.

## nginx

This is an example configuration for running the web client with Nginx.

HTTPS support can be activated afterwards with the `certbot` tool (automatically gets a certificate from Let's Encrypt).

```
server {

        server_name yourserver.org;
        
        # Disable logs for privacy. Otherwise IP addresses are stored.
        access_log off;
        error_log off;

        # Forward the WebSocket 'wss://yourserver.org/ws' to the WebSocket served by the picotalk-server.
        location /ws {
                proxy_pass http://localhost:9998/ws; # This points to the websocket served by picotalk-server.
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "Upgrade";
                proxy_set_header Host $host;
        }

        # Server static content for the web client.
        location / { # Adapt this path to your needs. Maybe you'd like to have the web page under /talk, etc...
                # This is the path to the directory which contains the static HTML and JS files for the web client.
                root /var/www/html/picotalk-web-static;
        }

}
```

Example for activating HTTPS:

```bash
certbot --nginx -d yourserver.org
```
