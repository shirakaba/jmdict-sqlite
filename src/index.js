const path = require('path');
const { program } = require('commander');
const https = require('https'); // or 'https' for https:// URLs
const fs = require('fs');
const fsPromises = require('fs').promises;
const tmp = require('tmp');
const child_process = require('child_process');

/**
 * @param {string} input The URL to download from
 * @param {string} output The filepath to output to.
 * @returns {Promise<string>}
 */
function download(input, output) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(output);
    writeStream.on('error', (error) => reject(error));
    writeStream.on('finish', () => {
      writeStream.close();
      resolve(output);
    });

    /**
     * @param {string} url
     */
    const get = (url) => {
      https.get(url, (response) => {
        const {
          headers: { location },
          statusCode,
        } = response;

        if (response.statusCode === 302) {
          if (!location) {
            reject(new Error('Got 302 redirect but no Location header.'));
            response.resume();
            return;
          }

          return get(location);
        }

        if (statusCode !== 200) {
          reject(new Error(`Got status code ${statusCode}`));
          response.resume();
          return;
        }

        response.pipe(writeStream);
      });
    };

    get(input);
  });
}

async function main() {
  program
    .description(
      'Download jmdict-simplified and use it to populate an SQLite database.'
    )
    .requiredOption(
      '-i --input <type>',
      'The input JSON file for jmdict-simplified.',
      './downloads/jmdict-eng-3.5.0.json'
    )
    .option(
      '-d --download-url <type>',
      'The download URL for jmdict-simplified.',
      'https://github.com/scriptin/jmdict-simplified/releases/download/3.5.0%2B20230710121913/jmdict-eng-3.5.0+20230710121913.json.zip'
    )
    .requiredOption(
      '-o --output <type>',
      'The output SQLite database filepath.',
      './output/jmdict.sqlite3'
    );

  program.parse();

  let { input, downloadUrl, output } = program.opts();

  input = path.resolve(process.cwd(), input);
  output = path.resolve(process.cwd(), output);
  console.log(input);

  if (!fs.existsSync(input)) {
    if (!downloadUrl) {
      console.log(
        "--input needed downloading, but --download-url wasn't specified."
      );
      process.exit(1);
    }
    try {
      const downloadsDir = path.dirname(input);
      await fsPromises.mkdir(downloadsDir, { recursive: true });

      const tmpName = path.basename(tmp.tmpNameSync());
      const tmpFilepath = path.resolve(process.cwd(), downloadsDir, tmpName);

      await download(downloadUrl, tmpFilepath);

      child_process.execSync(`unzip ${tmpFilepath} -d ${downloadsDir}`);

      await fsPromises.rm(tmpFilepath);
    } catch (error) {
      console.log('Failed to download jmdict-simplified.', error);
    }

    process.exit(1);
  }

  console.log(`TODO: output SQLite database to: ${output}`);
}

main().catch(console.error);
