# Copyright (c) 2020 Thomas Kramer.
# SPDX-FileCopyrightText: 2022 Thomas Kramer
#
# SPDX-License-Identifier: AGPL-3.0-or-later

import argparse
import asyncio
import aiohttp.web
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("WebServer")


async def index(request):
    raise aiohttp.web.HTTPFound('/index.html')


def main():
    parser = argparse.ArgumentParser("Server the picoTalk web user interface.")
    parser.add_argument('-l', '--listen', type=str,
                        metavar='ADDR',
                        default='0.0.0.0',
                        help="Listen address.")
    parser.add_argument('-p', '--port', type=int,
                        metavar='TCP_LISTEN_PORT',
                        default=80,
                        help="Listening port.")
    parser.add_argument('--uvloop', action='store_true',
                        help="Use 'uvloop' as eventloop.")
    args = parser.parse_args()

    if args.uvloop:
        try:
            # Try to use `uvloop` if it is installed.
            # uvloop could lead to better performance.
            import uvloop

            asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
            logger.info("Using 'uvloop'.")
        except ImportError as e:
            logger.info("'uvloop' is not available.")

    app = aiohttp.web.Application()
    app.router.add_get('/', index)
    app.router.add_static('/', './static/')
    aiohttp.web.run_app(app, host=args.listen, port=args.port)


if __name__ == '__main__':
    main()
