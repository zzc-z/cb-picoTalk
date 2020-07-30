# PicoTalk

PicoTalk aims to be a simple and privacy oriented solution for group-calls. PicoTalk relies on a central server that is used for signalling and also routing and mixing of the audio signals. The goal is to provide true end-to-end encrypted group-calls such that the server does not have to be trusted. This is work-in-progress tough.

An example with a web user interface can be found here:

* https://pages.codeberg.org/tok/talk
* https://talk.tkramer.ch

*PicoTalk Python* is the main implementation of picoTalk.
This includes a server and client program written in Python.

*PicoTalk Web* is an alternative implementation of the client which can be run from a browser.

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
PicoTalk Web is a *picoTalk* client written in HTML and JavaScript that can be run from the browser.

The web client can be run by opening `picotalk-web/static/index.html` in a browser or, alternatively,
serving the HTML/JavaScript content using a web server.

In contrast to other browser based voice call solutions this does not use WebRTC but simply WebSockets.
