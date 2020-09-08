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
from setuptools import setup, find_packages


def readme():
    with open("README.md", "r") as f:
        return f.read()


setup(name='picotalk',
      version='0.0.20',
      description='Simple voice call tool.',
      long_description=readme(),
      long_description_content_type="text/markdown",
      keywords='voice call',
      classifiers=[
          'License :: OSI Approved :: GNU Affero General Public License v3',
          'Development Status :: 4 - Beta',
          'Programming Language :: Python :: 3.8'
      ],
      url='https://codeberg.org/tok/picotalk',
      author='T. Kramer',
      author_email='code@tkramer.ch',
      license='AGPL v3',
      packages=find_packages(),
      entry_points={
          'console_scripts': [
              'picotalk-client = picotalk.client:main',
              'picotalk-server = picotalk.server:main'
          ]
      },
      install_requires=[
          'pyaudio',
          'pynacl',
          'numpy',  # BSD
          'scipy',  # BSD
      ],
      zip_safe=False)
