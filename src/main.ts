import { Bold, Faint, FgBrightGreen, FgBrightMagenta, FgBrightYellow, FgCyan, FgYellow, modify } from 'ansi-es6';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import * as readline from 'readline';
import { fetch } from 'undici';
import { ColorOption, CommandLineArgs, isValidColorOption, OptionDefinition } from './command-line';
import { parse, Result, SupplementalInfo } from './parsing';
import pkg from '../package.json';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const base = 'https://jisho.org';

const main = async () =>
{
	const definitions: OptionDefinition[] = [
		{ name: 'help', alias: 'h', type: Boolean, defaultValue: false },
		{ name: 'interactive', alias: 'i', type: Boolean, defaultValue: false },
		{ name: 'reverse', alias: 'r', type: Boolean, defaultValue: false },
		{ name: 'color', alias: 'c', type: String, defaultValue: 'auto' },
		{ name: 'term', defaultOption: true, type: String },
	];
	const { help, interactive, term, reverse: topToBottom, color } = <CommandLineArgs>commandLineArgs(definitions);

	if (isValidColorOption(color) == false)
	{
		console.error(`Invalid value for 'color': ${color}`);
		process.exit(1);
	}

	if (help || interactive == false && term == null)
	{
		const usage = commandLineUsage([
			{
				header: 'jisho-cli',
				content: 'Look up a term, English or Japanese, on jisho.org.',
			},
			{
				header: 'Synopsis',
				content: [
					'jisho-cli [options] {underline term}',
					'jisho-cli [options] {bold -i} [{underline term}]',
				]
			},
			{
				header: 'Options',
				optionList: [
					{
						alias: 'i',
						name: 'interactive',
						description: 'If set, the application executes interactively. Faster when looking up multiple terms.',
					},
					{
						alias: 'c',
						name: 'color',
						description: 'Enables or disables color output.' +
							' Valid values are: {underline auto} (default), {underline always}, {underline never}.' +
							'\n{underline auto} enables coloring for TTYs.',
					},
					{
						alias: 'r',
						name: 'reverse',
						description: 'Show results top to bottom.',
					},
					{
						alias: 'h',
						name: 'help',
						description: 'Print this message.',
					}
				]
			}
		]);
		console.log(usage);
		process.exit(1);
	}

	// To catch Ctrl+D
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY)
		process.stdin.setRawMode!(true);

	const readInterface = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: process.stdin.isTTY,
	});

	const colorize = conditionalModify(useColor(<ColorOption>color));

	const question = (q: string) => new Promise<string>(res =>
	{
		readInterface.question(q, answer =>
		{
			console.log();
			res(answer);
		});
	});

	let needInput = term == null;
	while (true)
	{
		const rawTerm = needInput ?
			await question(colorize("Search term: ", FgBrightYellow)) : term!;

		const currentTerm = rawTerm.trim();
		if (currentTerm == '')
			break;

		needInput = true;

		if (process.stdout.isTTY)
			process.stdout.write(colorize('Searching...', FgYellow));

		const clr = () =>
		{
			if (process.stdout.isTTY)
			{
				readline.clearLine(process.stdout, -1);
				readline.cursorTo(process.stdout, 0);
			}
		};

		try
		{
			const results = await lookUpTerm(currentTerm);
			clr();

			if (topToBottom == false)
				results.reverse();

			results.forEach(result =>
			{
				const audioIndicator = result.audioUrl ? colorize(' 🔊', FgCyan) : '';
				console.log(`${colorize(result.text, Bold, FgBrightGreen)} [${colorize(result.reading, FgBrightMagenta)}]${audioIndicator}:`);
				result.items.forEach(m =>
				{
					switch (m.type)
					{
						case 'meaning':
							const prefix = m.number === undefined
								? ''
								: (colorize(m.number, Faint) + ' ');
							
							const suffix = m.supplementalInfo.length == 0
								? ''
								: (colorize(' - ' + renderInfo(m.supplementalInfo), Faint));

							console.log(`\t${prefix}${m.text}${suffix}`);
							break;
						case 'tag':
							console.log(`\t${colorize(m.text, FgCyan)}`);
							break;
					}
				});
				console.log();
			});

			// Offer interactive pronunciation playback if any results have audio
			if (process.stdin.isTTY && results.some(r => r.audioUrl))
			{
				await handleInteractiveSelection(results, colorize);
			}
		}
		catch (e)
		{
			clr();

			console.error("An error occurred fetching the results.");
			console.error(e);
		}

		if (interactive == false)
			break;
	}

	readInterface.close();
}

const useColor = (colorArgument: ColorOption) =>
{
	switch (colorArgument)
	{
		case 'auto':
			return 'NO_COLOR' in process.env == false && process.stdout.isTTY == true;
		case 'always':
			return true;
		case 'never':
			return false;
	}
}

const conditionalModify = (useColor: boolean) => (text: string, ...modifiers: string[]) =>
{
	return useColor ? modify(text, ...modifiers) : text;
}

async function lookUpTerm(term: string): Promise<Result[]>
{
	const response = await fetch(`${base}/search/${term}`, {
		headers: {
			'User-Agent': `jisho-cli v${pkg.version} (${pkg.repository.url})`,
		},
	});
	if (response.ok == false)
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);

	const html = await response.text();
	return parse(html);
}

function renderInfo(supplementalInfo: SupplementalInfo[])
{
	return supplementalInfo
		.map(x =>
		{
			switch (x.type)
			{
				case 'tag':
					return x.text;
				case 'see-also':
					return `see also ${link(x.text, base + x.href)}`;
			}
		})
		.join(', ');
}

function link(text: string, href: string)
{
	return `\x1b]8;;${href}\x1b\\${text}\x1b]8;;\x1b\\`;
}

async function downloadAudio(url: string): Promise<string>
{
	// Normalize URL to have https protocol
	const fullUrl = url.startsWith('//') ? `https:${url}` : url;
	
	const response = await fetch(fullUrl);
	if (!response.ok)
		throw new Error(`Failed to download audio: ${response.status}`);
	
	const buffer = await response.arrayBuffer();
	const tmpFile = path.join(os.tmpdir(), `jisho-audio-${Date.now()}.mp3`);
	fs.writeFileSync(tmpFile, Buffer.from(buffer));
	
	return tmpFile;
}

async function playAudio(audioPath: string): Promise<void>
{
	return new Promise((resolve, reject) =>
	{
		// Try different audio players in order of preference
		const players = ['mpg123', 'ffplay', 'afplay', 'play'];
		
		const tryPlayer = (index: number) =>
		{
			if (index >= players.length)
			{
				reject(new Error('No audio player found. Please install mpg123, ffplay, or sox.'));
				return;
			}
			
			const player = players[index];
			const args = player === 'ffplay' 
				? ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioPath]
				: player === 'play'
				? ['-q', audioPath]
				: ['-q', audioPath];
			
			const proc = spawn(player, args, { stdio: 'ignore' });
			
			proc.on('error', () => tryPlayer(index + 1));
			proc.on('close', (code) =>
			{
				if (code === 0)
					resolve();
				else
					tryPlayer(index + 1);
			});
		};
		
		tryPlayer(0);
	});
}

async function handleInteractiveSelection(results: Result[], colorize: (text: string, ...modifiers: string[]) => string): Promise<void>
{
	const resultsWithAudio = results.filter(r => r.audioUrl);
	
	if (resultsWithAudio.length === 0)
	{
		console.log(colorize('\nNo audio pronunciations available for these results.', Faint));
		return;
	}
	
	console.log(colorize('\nUse arrow keys to navigate, Enter to play pronunciation, Esc or q to skip:', FgYellow));
	
	let selectedIndex = 0;
	
	const displaySelection = () =>
	{
		readline.cursorTo(process.stdout, 0);
		readline.clearScreenDown(process.stdout);
		
		resultsWithAudio.forEach((result, index) =>
		{
			const prefix = index === selectedIndex ? colorize('▶ ', FgBrightYellow) : '  ';
			const audioIndicator = colorize('🔊', FgCyan);
			console.log(`${prefix}${colorize(result.text, Bold, FgBrightGreen)} [${colorize(result.reading, FgBrightMagenta)}] ${audioIndicator}`);
		});
	};
	
	displaySelection();
	
	return new Promise((resolve) =>
	{
		const onKeypress = async (str: string, key: any) =>
		{
			if (key.name === 'up')
			{
				selectedIndex = (selectedIndex - 1 + resultsWithAudio.length) % resultsWithAudio.length;
				displaySelection();
			}
			else if (key.name === 'down')
			{
				selectedIndex = (selectedIndex + 1) % resultsWithAudio.length;
				displaySelection();
			}
			else if (key.name === 'return')
			{
				const selectedResult = resultsWithAudio[selectedIndex];
				if (selectedResult.audioUrl)
				{
					try
					{
						readline.cursorTo(process.stdout, 0);
						process.stdout.write(colorize('Playing...', FgYellow));
						
						const audioPath = await downloadAudio(selectedResult.audioUrl);
						await playAudio(audioPath);
						fs.unlinkSync(audioPath);
						
						readline.cursorTo(process.stdout, 0);
						readline.clearLine(process.stdout, 0);
					}
					catch (error)
					{
						readline.cursorTo(process.stdout, 0);
						readline.clearLine(process.stdout, 0);
						console.log(colorize(`Error playing audio: ${error}`, FgYellow));
					}
					
					displaySelection();
				}
			}
			else if (key.name === 'escape' || str === 'q')
			{
				process.stdin.removeListener('keypress', onKeypress);
				readline.cursorTo(process.stdout, 0);
				readline.clearScreenDown(process.stdout);
				resolve();
			}
		};
		
		process.stdin.on('keypress', onKeypress);
	});
}

main();
