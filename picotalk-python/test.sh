#!/bin/bash

# SPDX-FileCopyrightText: 2024 Thomas Kramer
#
# SPDX-License-Identifier: CC0-1.0


pytest src/

# Test installation
picotalk-client -h
picotalk-server -h

