import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function ytdlpSearch(python: string, ffmpegLocation: string, query: string): Promise<string> {
  const args = ['-m', 'yt_dlp'];
  if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation);
  args.push('--no-check-certificates', '--js-runtimes', 'node:node', '-f',
    'ba[ext=m4a]/bestaudio/best', '--playlist-end', '4', '--print',
    '%(duration)s|%(view_count)s|%(title)s|%(channel)s|%(url)s', `ytsearch4:${query}`);
  // Catalogue titles and queries are data, including shell metacharacters.
  const { stdout } = await execFileAsync(python, args, {
    timeout: 18000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return stdout;
}
