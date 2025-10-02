# jisho-cli

A small command line utility that converts results from [jisho.org](https://jisho.org) to plain terminalese.

Here some output for the search term `arashi`:

![screenshot](https://raw.githubusercontent.com/brunnerh/jisho-cli/master/readme-files/screenshot.png)

**Note:** The extraction of the kana reading may not be completely accurate in some cases. Also, changes to the site may break the application.

## Installation

The application can be installed from [npm](https://www.npmjs.com/):

```shell
npm install -g jisho-cli
```

`-g` installs it globally. If you have added your global Node `.bin` directory to the path you then can use the command `jisho-cli` anywhere.

## Usage

You can search for any term in English and Japanese (both Romaji and Kana/Kanji).

Examples:

```shell
% jisho-cli arashi
% jisho-cli 嵐
% jisho-cli storm
```

The flag `-i` can be used to start the application interactively. The user then is prompted for search terms repeatedly (the first search term can still be provided as argument). Pressing enter without entering any text exits the application.

Using interactive mode is recommended for multiple searches as it keeps the session/cache alive. Subsequent requests thus need to transmit less data.

### Audio Pronunciation

When available, pronunciation audio is indicated with a 🔊 icon next to the hiragana reading. After viewing results, you can use the arrow keys to navigate between entries with audio, and press Enter to play the pronunciation in your terminal.

**Note:** Audio playback requires an audio player to be installed on your system. The application will automatically use one of the following (in order of preference): `mpg123`, `ffplay` (part of FFmpeg), `afplay` (macOS), or `play` (part of SoX).
