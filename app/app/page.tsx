import Script from 'next/script'
import MiniApp from './MiniApp'

export const metadata = { title: 'Wink' }

export default function Page() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js?59" strategy="beforeInteractive" />
      <MiniApp />
    </>
  )
}
