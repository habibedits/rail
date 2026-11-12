// Preload for third-party sites (claude.ai, Notion). Exposes nothing to the
// page: it reports swipe gestures to the shell and, on Notion, trims the
// wide desktop page margins while the pane is narrow.
import { ipcRenderer, webFrame } from 'electron';
import { installSwipe } from './swipe';
import { installNotionCompact } from './notionCompact';
import { installSlackCompact } from './slackCompact';

installSwipe((dir) => ipcRenderer.send('rail:swipe', dir));

if (/(^|\.)notion\.(so|com)$/.test(location.hostname) && location.hostname !== 'calendar.notion.so') installNotionCompact();
if (location.hostname === 'app.slack.com') installSlackCompact();

// Slack is silent in Rail (user preference): no notifications and no alert
// sounds. Runs in the page, before Slack's own scripts.
//  - Notifications: the page sees permission "denied", and creating one does nothing.
//  - Sounds: an <audio>/Audio() that Slack starts on its own (not right after
//    a click) doesn't play. Huddle audio (live streams) and clips the user
//    clicks to play are untouched.
if (location.hostname === 'app.slack.com') {
  webFrame.executeJavaScript(`(() => {
    if (window.__railQuiet) return;
    Object.defineProperty(window, '__railQuiet', { value: true });
    class QuietNotification extends EventTarget {
      constructor(title, opts) { super(); this.title = title; Object.assign(this, opts || {}); }
      close() {}
      static get permission() { return 'denied'; }
      static requestPermission(cb) { cb && cb('denied'); return Promise.resolve('denied'); }
    }
    window.Notification = QuietNotification;
    const clicked = () => !!(navigator.userActivation && navigator.userActivation.isActive);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement && !this.srcObject && !clicked()) return Promise.resolve();
      return play.apply(this, arguments);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      if (!clicked()) return;
      return start.apply(this, arguments);
    };
  })();`);
}
