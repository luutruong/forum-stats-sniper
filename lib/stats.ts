import {load} from 'cheerio'

type ForumStats = {
  members: number
  threads: number
  posts: number
}

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

export default {
  getVBulletinStats,
  getXFStats,
  getXMBStats,
  getYaBBStats,

  getSMFStats: function (html: string, stats: ForumStats) {
    const $ = load(html);

    const text = $('#upshrinkHeaderIC span.middletext').text().trim().replace('  ', ' ')
    console.log(text)
    const match = text.match(/^(\d+) posts in (\d+) topics by (\d+) members/gi)

    if (match) {
      const parts = match[0].split(' ')
      while (parts.length > 0) {
        const part = parts.shift() as string
        const num = parseNumber(part)
        if (Number.isNaN(num)) {
          continue
        }

        if (stats.posts === -1) {
          Object.assign(stats, {...stats, posts: num})
        } else if (stats.threads === -1) {
          Object.assign(stats, {...stats, threads: num})
        } else if (stats.members === -1) {
          Object.assign(stats, {...stats, members: num})
        }
      }
    }
  },
}