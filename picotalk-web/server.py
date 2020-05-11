#
# Copyright (c) 2020 Thomas Kramer.
#
# This file is part of picoTalk 
# (see https://codeberg.org/tok/picotalk).
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#
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
