import {parse} from 'csv-parse'
import {stringify} from 'csv-stringify'
import fs from 'fs'
import axios from 'axios'
import _ from 'lodash'
import {load} from 'cheerio'
import path from 'path'

type ForumStats = {
  members: number
  threads: number
  posts: number
}

const LAST_RUN_FILENAME = path.resolve(__dirname, 'last_run.txt')

const parseNumber = (num: string) => {
  return parseInt(num.replace(',', '').trim(), 10)
}

const getXFStats = (html: string, stats: ForumStats) => {
  const $ = load(html)

  if ($('div[data-widget-key="forum_overview_forum_statistics"]').length > 0) {
    const els = $('div[data-widget-key="forum_overview_forum_statistics"] .pairs dd')
    Object.assign(stats, {
      ...stats,
      threads: parseNumber($(els[0]).text()),
      posts: parseNumber($(els[1]).text()),
      members: parseNumber($(els[2]).text()),
    })

    return
  }

  if ($('html').attr('id') === 'XenForo') {
    // XF 1.x.x
    Object.assign(stats, {
      ...stats,
      members: parseNumber($('.memberCount dd').text()),
      threads: parseNumber($('.discussionCount dd').text()),
      posts: parseNumber($('.messageCount dd').text()),
    })

    return
  }

  // xf 2.x.x
  Object.assign(stats, {
    ...stats,
    members: parseNumber($('.count--users dd').text()),
    threads: parseNumber($('.count--threads dd').text()),
    posts: parseNumber($('.count--messages dd').text()),
  })
}
const getYaBBStats = (html: string, stats: ForumStats) => {
  const $ = load(html)

  const els = $('.forumStatisticsContent span')
  els.each((_i, el) => {
    const elId = $(el).attr('id')
    if (!elId) {
      return
    }

    if (elId.includes('ForumStats_StatsPostsTopicCount')) {
      const parts = $(el).text().trim().split(' ')
      while (parts.length > 0) {
        const part = parts.shift() as string
        const num = parseNumber(part)

        if (stats.posts === -1 && !Number.isNaN(num)) {
          Object.assign(stats, {...stats, posts: num})
        } else if (stats.threads === -1 && !Number.isNaN(num)) {
          Object.assign(stats, {...stats, threads: num})
        }
      }
    } else if (elId.includes('ForumStats_StatsMembersCount')) {
      const parts = $(el).text().trim().split(' ')
      while (parts.length > 0) {
        const part = parts.shift() as string
        const num = parseNumber(part)
        if (num > 0) {
          Object.assign(stats, {...stats, members: num})
        }
      }
    }
  })
}

const getXMBStats = (html: string, stats: ForumStats) => {
  const $ = load(html)
  let merged = false

  $('table td').each((_i, el) => {
    const strongEls = $(el).find('>strong')
    if (strongEls.length === 3 && merged === false) {
      merged = true
      Object.assign(stats, {
        ...stats,
        members: parseNumber($(strongEls[2]).text().trim()),
        posts: parseNumber($(strongEls[1]).text().trim()),
        threads: parseNumber($(strongEls[0]).text().trim()),
      })
    }
  })
}

const getVBulletinStats = (html: string, stats: ForumStats) => {
  const $ = load(html)

  if ($('#wgo_stats').length > 0) {
    const els = $('#wgo_stats div dl:first-child dd')
    if (els.length === 4) {
      Object.assign(stats, {
        ...stats,
        threads: parseNumber($(els[0]).text()),
        posts: parseNumber($(els[1]).text()),
        members: parseNumber($(els[2]).text()),
      })
    }
  } else if ($('#collapseobj_forumhome_stats').length > 0) {
    const parts = $('#collapseobj_forumhome_stats div.smallfont>div').text().trim().split(' ')
    while (parts.length > 0) {
      const part = parts.shift() as string
      const num = parseNumber(part)
      if (Number.isNaN(num)) {
        continue
      }

      if (stats.threads === -1) {
        Object.assign(stats, {...stats, threads: num})
      } else if (stats.posts === -1) {
        Object.assign(stats, {...stats, posts: num})
      } else if (stats.members === -1) {
        Object.assign(stats, {...stats, members: num})
      }
    }
  } else {
    console.warn('No widget stats')
  }
}

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
      writeResults([...row, 'Members', 'Posts', 'Threads', 'Forum Detected'])

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
      let result = [...row, 0, 0, 0, 'No']
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
        const stats: ForumStats = {
          members: -1,
          posts: -1,
          threads: -1,
        }
        const platformLower = platform.toLowerCase()
        if (platformLower === 'xenforo') {
          getXFStats(resp.data, stats)
        } else if (platformLower === 'yabb') {
          getYaBBStats(resp.data, stats)
        } else if (platformLower === 'xmb') {
          getXMBStats(resp.data, stats)
        } else if (platformLower === 'vbulletin') {
          getVBulletinStats(resp.data, stats)
        }

        console.log(stats)

        result[3] = Number.isNaN(stats.members) ? -1 : stats.members
        result[4] = Number.isNaN(stats.posts) ? -1 : stats.posts
        result[5] = Number.isNaN(stats.threads) ? -1 : stats.threads
      } catch (e: any) {
        console.log(e.message)
        result[6] = 'No'
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
