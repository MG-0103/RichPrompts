import Editor from "@monaco-editor/react"
import { badPrompt } from "@richprompt/core"
import './App.css'

function App() {
  return (
    <Editor 
      height="90vh" 
      defaultLanguage="markdown"
      defaultValue={badPrompt} 
    />
  )
}

export default App
