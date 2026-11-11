const en = {
  'app.skipToMain': 'Skip to main content',
  'nav.menu': 'Menu',
  'nav.overview': 'Overview',
  'nav.otherRoles': 'Other Roles',
  'nav.workspaceSuffix': 'workspace',
  'nav.notifications': 'Notifications',
  'nav.closeNotifications': 'Close notifications',
  'nav.markRead': 'Mark read',
  'nav.noNotifications': 'No notifications yet.',
  'nav.darkMode': 'Dark mode',
  'nav.lightMode': 'Light mode',
  'auth.signOut': 'Sign out',
  'role.student': 'Student',
  'role.instructor': 'Instructor',
  'role.admin': 'Admin',
  'section.catalog': 'Course catalog',
  'section.learning': 'My learning',
  'section.courses': 'My courses',
  'section.approvals': 'Course approvals',
  'section.users': 'Users',
  'section.metrics': 'Platform metrics',
  'section.moderation': 'Moderation queue',
  'community.leaderboardTitle': 'Course leaderboard',
  'community.announcementsTitle': 'Course announcements',
  'community.forumTitle': 'Discussion forum',
  'community.postAnnouncement': 'Post announcement',
  'community.startThread': 'Start thread',
  'community.reply': 'Reply',
  'community.report': 'Report',
  'community.hide': 'Hide',
  'community.restore': 'Restore',
  'community.dismiss': 'Dismiss',
  'community.hiddenNotice': 'Hidden by moderation',
  'community.noLeaders': 'No leaderboard entries yet.',
  'community.noAnnouncements': 'No announcements posted yet.',
  'community.noThreads': 'No discussion threads yet. Start the conversation below.'
} as const

export type TranslationKey = keyof typeof en

export function useT() {
  return (key: TranslationKey) => en[key]
}
