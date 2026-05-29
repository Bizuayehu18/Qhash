import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export const Route = createFileRoute('/faq')({
  component: FAQ,
})

const faqs = [
  {
    question: 'What is QHash?',
    answer:
      'QHash is a cloud-mining platform that allows Ethiopian users to invest in mining plans and earn daily returns. You buy a plan, and your investment generates daily earnings for the duration of the contract.',
  },
  {
    question: 'How do I get started?',
    answer:
      'Register with your Ethiopian phone number, deposit funds into your wallet, and choose a mining plan that fits your budget. Your earnings begin immediately after activating a plan.',
  },
  {
    question: 'What mining plans are available?',
    answer:
      'QHash offers six plans ranging from Starter (500 ETB) to Elite (30,000 ETB). Each plan has a different daily earning rate and contract duration. Visit the Mining Plans page after logging in to see all options.',
  },
  {
    question: 'How are daily earnings calculated?',
    answer:
      'Each plan has a fixed daily earning rate. For example, the Starter plan earns 20 ETB per day for 150 days. Earnings are credited to your wallet automatically.',
  },
  {
    question: 'How do deposits work?',
    answer:
      'You can deposit funds via supported payment gateways. The minimum deposit is 200 ETB. Funds are typically credited to your wallet within minutes of confirmation.',
  },
  {
    question: 'How do withdrawals work?',
    answer:
      'You can request a withdrawal from your wallet balance at any time. Withdrawals are reviewed and processed within 24 hours. A 2% processing fee applies. The minimum withdrawal amount is 500 ETB.',
  },
  {
    question: 'How does the referral program work?',
    answer:
      'The referral program is currently being rebuilt. Check back soon for details on how you can earn by inviting friends to QHash.',
  },
  {
    question: 'Is my account secure?',
    answer:
      'QHash uses phone-number based authentication with encrypted sessions. Your account is protected by your password. We recommend using a strong, unique password and never sharing your login credentials.',
  },
  {
    question: 'How do I contact support?',
    answer:
      'Visit the Support page inside the app to submit a ticket. Our team typically responds within 24 hours.',
  },
]

function FAQ() {
  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] px-4 pt-10 pb-12 max-w-[480px] mx-auto">
      <h1 className="text-xl font-bold text-center mb-2 text-white">
        Frequently Asked Questions
      </h1>
      <p className="text-center text-xs text-gray-500 mb-8">
        Got questions? We've got answers.
      </p>
      <div className="space-y-2">
        {faqs.map((faq, i) => (
          <Accordion key={i} question={faq.question} answer={faq.answer} />
        ))}
      </div>
    </div>
  )
}

function Accordion({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-[#1a1a1a] rounded-xl overflow-hidden bg-[#111]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left text-white"
      >
        <span className="font-medium text-sm pr-2">{question}</span>
        <ChevronDown
          size={16}
          className={`text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-xs leading-relaxed text-gray-400">{answer}</div>
      )}
    </div>
  )
}
