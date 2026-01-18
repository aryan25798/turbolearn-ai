'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import 'katex/dist/katex.min.css';
import { Check, Copy, Volume2, StopCircle } from 'lucide-react';

// --- SUB-COMPONENT: Code Block ---
const CodeBlock = ({ language, code }: { language: string, code: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl overflow-hidden bg-[#1e1f20] border border-[#2c2d2e] shadow-lg w-full group">
      <div className="flex justify-between items-center bg-[#262729] px-4 py-2 border-b border-[#2c2d2e] select-none">
        <span className="text-[11px] uppercase tracking-wider font-bold text-gray-400 font-mono">{language || 'text'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md">
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto w-full custom-scrollbar">
        <SyntaxHighlighter 
          language={language?.toLowerCase() || 'text'} 
          style={vscDarkPlus} 
          PreTag="div" 
          showLineNumbers={true} 
          wrapLines={true} 
          customStyle={{ margin: 0, padding: '1rem', background: '#1e1f20', fontSize: '13px', lineHeight: '1.6' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

// --- MAIN COMPONENT: Markdown Renderer ---
export default function MarkdownRenderer({ 
  content, 
  msgId, 
  isSpeaking, 
  onToggleSpeak 
}: { 
  content: string, 
  msgId: string, 
  isSpeaking: boolean, 
  onToggleSpeak: (text: string, id: string) => void 
}) {
  return (
    <div className="relative group max-w-full">
      <button 
        onClick={() => onToggleSpeak(content, msgId)}
        className={`absolute top-0 right-0 p-2 rounded-lg transition-all duration-200 z-10
          ${isSpeaking 
            ? 'bg-red-500/10 text-red-400 opacity-100 ring-1 ring-red-500/50' 
            : 'text-gray-400 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 mobile-visible'
          }`}
        title={isSpeaking ? "Stop Reading" : "Read Aloud"}
      >
        {isSpeaking ? <StopCircle size={16} className="animate-pulse" /> : <Volume2 size={16} />}
      </button>

      <div className="pr-8 overflow-hidden">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]} 
          rehypePlugins={[rehypeKatex]} 
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? 
                <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} /> : 
                <code className="bg-[#2c2d2e] text-orange-200 px-1.5 py-0.5 rounded-md text-[13px] font-mono border border-white/5 break-words whitespace-pre-wrap" {...props}>{children}</code>;
            },
            p({ children }) { return <p className="mb-4 text-[14px] md:text-[15px] leading-7 text-gray-200">{children}</p>; },
            ul({ children }) { return <ul className="list-disc pl-5 mb-4 space-y-2 text-gray-300 text-[14px] md:text-[15px] marker:text-gray-500">{children}</ul>; },
            ol({ children }) { return <ol className="list-decimal pl-5 mb-4 space-y-2 text-gray-300 text-[14px] md:text-[15px] marker:text-gray-500">{children}</ol>; },
            h1({ children }) { return <h1 className="text-xl md:text-2xl font-bold mb-4 text-white pb-2 border-b border-gray-700/50">{children}</h1>; },
            h2({ children }) { return <h2 className="text-lg md:text-xl font-bold mb-3 text-white mt-6">{children}</h2>; },
            h3({ children }) { return <h3 className="text-base md:text-lg font-bold mb-2 text-white mt-4">{children}</h3>; },
            a({ children, href }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-400/30 hover:decoration-blue-400 transition-all break-all">{children}</a>; },
            blockquote({ children }) { return <blockquote className="border-l-4 border-blue-500/30 pl-4 py-1 my-4 bg-blue-500/5 rounded-r-lg italic text-gray-400">{children}</blockquote>; },
            table({ children }) { return <div className="overflow-x-auto my-4 rounded-lg border border-gray-700/50 custom-scrollbar"><table className="min-w-full text-left text-sm text-gray-300">{children}</table></div>; },
            th({ children }) { return <th className="bg-[#262729] p-3 font-semibold text-white border-b border-gray-700 whitespace-nowrap">{children}</th>; },
            td({ children }) { return <td className="p-3 border-b border-gray-700/50 min-w-[120px]">{children}</td>; },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}