import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import BootProbe from "@/components/BootProbe";
import "./globals.css";

/**
 * Deliberately written in plain ES5 — no arrow functions, no const/let, no
 * template literals — because its whole job is to still run on a browser
 * too old to parse the main bundle. If React hasn't hydrated ten seconds
 * in, it says so on screen, with the browser's own user-agent string and
 * whatever error fired, so the person sitting at that machine can read it
 * out instead of just reporting "the button doesn't work". See BootProbe.
 */
const BOOT_GUARD = `(function(){
var errs=[];
function note(m){if(m){m=String(m).slice(0,200);if(errs.indexOf(m)<0){errs.push(m);}}}
window.addEventListener('error',function(e){note(e&&(e.message||(e.target&&e.target.src)));},true);
window.addEventListener('unhandledrejection',function(e){note(e&&e.reason);});
setTimeout(function(){
if(window.__APP_HYDRATED){return;}
if(document.getElementById('legacy-boot-notice')){return;}
var box=document.createElement('div');
box.id='legacy-boot-notice';
box.setAttribute('style','position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#a1332b;color:#fff;padding:12px 16px;font:14px/1.5 Arial,Helvetica,sans-serif');
var h=document.createElement('div');
h.setAttribute('style','font-weight:bold');
h.appendChild(document.createTextNode('This page did not finish loading on this browser \\u2014 Sign in and other buttons will not work.'));
box.appendChild(h);
var p=document.createElement('div');
p.appendChild(document.createTextNode('Please update Google Chrome and reload. If that does not help, show this line to whoever maintains the app:'));
box.appendChild(p);
var d=document.createElement('div');
d.setAttribute('style','font-size:12px;opacity:.9;margin-top:4px;word-break:break-all');
d.appendChild(document.createTextNode(navigator.userAgent+(errs.length?' \\u2014 '+errs.join(' | '):'')));
box.appendChild(d);
if(document.body){document.body.appendChild(box);}
},10000);
})();`;

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Noon Enterprises",
  description: "Internal service and sales tracking for the water purifier team",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: BOOT_GUARD }} />
        <BootProbe />
        {children}
      </body>
    </html>
  );
}
