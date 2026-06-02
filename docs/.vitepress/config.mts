import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'RDSS Folder Mapper',
  description: 'Map research storage network folders to your Desktop',
  base: '/rdss-folder-mapper/',

  head: [
    ['link', { rel: 'icon', href: '/rdss-folder-mapper/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'RDSS Folder Mapper',

    nav: [
      { text: 'Guide', link: '/guide/installation' },
      { text: 'GitHub', link: 'https://github.com/eresearchqut/rdss-folder-mapper' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Installation', link: '/guide/installation' },
        ],
      },
      {
        text: 'Using the App',
        items: [
          { text: 'Desktop GUI', link: '/guide/gui' },
          { text: 'Command Line (CLI)', link: '/guide/cli' },
          { text: 'Your Data & Privacy', link: '/guide/privacy' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/eresearchqut/rdss-folder-mapper' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © eResearch QUT',
    },
  },
})
