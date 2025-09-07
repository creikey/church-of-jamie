import jamie from './assets/jamie.png'
import { useEffect, useState } from 'react'
import type { HelloResponse } from '../shared/api'

function App() {
  const [message, setMessage] = useState<string>("")
  const [clicked, setClicked] = useState<boolean>(false)
  useEffect(() => {
    fetch('/api')
      .then((r) => r.json())
      .then((d: { message: string }) => setMessage(d.message))
      .catch(() => setMessage(''))
  }, [])

  const onClickFetch = async () => {
    try {
      const r = await fetch('/api')
      const data: HelloResponse = await r.json()
      setMessage(data.message)
      setClicked(true)
    } catch {
      // ignore
    }
  }

  return (
    <div>
      {message && <p>{message}</p>}
      <button onClick={onClickFetch}>
        {clicked ? 'Fetched again' : 'Fetch from /api'}
      </button>
    </div>
  )
}

export default App
