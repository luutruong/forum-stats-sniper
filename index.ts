import {parse} from 'csv-parse'
import {stringify} from 'csv-stringify'
import fs from 'fs'
import axios from 'axios'
import _ from 'lodash'
import path from 'path'
import forumStats from './lib/stats'

const LAST_RUN_FILENAME = path.resolve(__dirname, 'last_run.txt')


const toCSV = (data: any[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    stringify(data, (err, output) => {
      if (err) {
        reject(err)
        return
      }

      resolve(output)
    })
  })
}

const writeResults = async (data: string[]) => {
  const output = await toCSV([data])
  fs.appendFileSync(path.resolve(__dirname, 'results.csv'), output)
}

const parser = parse({delimiter: ','}, async (err, data) => {
  if (err) {
    throw err
  }

  const totalRows = data.length
  let index = 0
  console.time('timeElapsed')

  let lastRunIndex = fs.existsSync(LAST_RUN_FILENAME) ? parseInt(fs.readFileSync(LAST_RUN_FILENAME, 'utf-8'), 10) : -1
  if (Number.isNaN(lastRunIndex)) {
    lastRunIndex = -1
  }

  for await (const row of data) {
    if (row[0] === 'Domain') {
      writeResults([...row, 'Members', 'Posts', 'Threads', 'Forum Detected', 'Error'])

      continue
    }

    ++index
    if (index <= lastRunIndex) {
      // already processed. skipping
      continue
    }

    const [domain, url, platform] = row as string[]
    const urls = (url as string)
      .split(';')
      .map((v) => _.trim(v))
      .map((v) => _.trimEnd(v, '/*'))
    console.group(`${domain} ${platform} ${index} / ${totalRows}`)

    for await (const urlToFetch of urls) {
      console.log('fetch', urlToFetch)
      console.time()
      // 3 -> members
      // 4 -> posts
      // 5 -> threads
      // 6 -> forum detected
      // 7 -> error
      let result = [...row, 0, 0, 0, 'No', '']
      result[1] = urlToFetch

      try {
        const resp = await axios.get(`http://${urlToFetch}`, {
          timeout: 3000,
          validateStatus: (status) => status >= 200 && status <= 403,
          maxRedirects: 3,
          withCredentials: true,
          headers: {
            cookie: '',
          },
        })

        result[6] = 'Yes'
        const stats = {
          members: -1,
          posts: -1,
          threads: -1,
        }
        const platformLower = platform.toLowerCase()
        if (platformLower === 'xenforo') {
          forumStats.getXFStats(resp.data, stats)
        } else if (platformLower === 'yabb') {
          forumStats.getYaBBStats(resp.data, stats)
        } else if (platformLower === 'xmb') {
          forumStats.getXMBStats(resp.data, stats)
        } else if (platformLower === 'vbulletin') {
          forumStats.getVBulletinStats(resp.data, stats)
        } else if (platformLower === 'smf') {
          forumStats.getSMFStats(resp.data, stats)
        }

        console.log(stats)

        result[3] = Number.isNaN(stats.members) ? -1 : stats.members
        result[4] = Number.isNaN(stats.posts) ? -1 : stats.posts
        result[5] = Number.isNaN(stats.threads) ? -1 : stats.threads
      } catch (e: any) {
        console.log(e.message)
        result[6] = 'No'
        result[7] = e.message
      }

      await writeResults(result)
      console.timeEnd()
    }

    fs.writeFileSync(LAST_RUN_FILENAME, String(index))
    console.groupEnd()
  }

  console.timeEnd('timeElapsed')
})

fs.createReadStream(`${__dirname}/forum_list.csv`).pipe(parser)
