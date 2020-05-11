# PicoTalk Python
*PicoTalk Python* is the main implementation of picoTalk.
This includes a server and client program written in Python.

## Install on Debian

Install the executables:
```sh
git clone [this repo]
cd [this repo]
cd picotalk-python
python3 setup.py --user develop
```

Install prerequisites:
```sh
sudo apt install python3-pyaudio python3-numpy python3-scipy python3-aiohttp python3-nacl
```

For the server only the following is necessary
```sh
sudo apt install python3-numpy python3-nacl
```

Optionally install `uvloop` for higher performance:
```sh
sudo apt install python3-uvloop
```

## Run the client

```sh
picotalk-client -s my.server.com -r mySecretRoom
```

## Run the server
```sh
picotalk-server # Use --uvloop to use uvloop.
```

# PicoTalk Web
PicoTalk Web is a *picoTalk* client written in HTML/JavaScript that can be run from the browser.

The web client can be run by opening `picotalk/web/static/index.html` in a browser or, alternatively,
serving the HTML/JavaScript content using a web server.