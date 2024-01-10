#!/bin/bash

# SPDX-FileCopyrightText: 2024 Thomas Kramer
#
# SPDX-License-Identifier: CC0-1.0

set -e

#pytest src/

# Test installation
#picotalk-client -h
picotalk-server -h

sleep 10 && killall picotalk-server &
picotalk-server &

echo "Test connection... "
sleep 1
response=$(echo "" | nc localhost 9999 | head -c 32)
killall picotalk-server
if [[ "$response" == *version* ]]; then
	echo Ok
else
	echo "unexpected server response: $response" 
	exit 1
fi
