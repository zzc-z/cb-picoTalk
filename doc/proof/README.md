<!--
SPDX-FileCopyrightText: 2022 Thomas Kramer

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Tamarin proof scripts

*Work-in-Progress*

This folder contains formal models of some cryptographic protocols used in picoTalk. The models are written for the [Tamarin Prover](https://tamarin-prover.github.io/). The idea is to automatically proove the relevant security properties of the non-standard protocols used in picoTalk.

Non-standard protocols include:

* The password authenticated key-exchange.
* The secure channel built on top of NaCl `secretbox`.
* Triple-Diffie-Hellman (3DH) authenticated key-exchange (this is part of the Signal/Axolotl protocol though)

