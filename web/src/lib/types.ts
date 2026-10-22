export type OrderStatus =
  | 'CLAIMED' | 'WAITLISTED' | 'CONFIRMED' | 'PROOF_SENT' | 'VERIFIED' | 'PACKED' | 'SHIPPED'
  | 'EXPIRED' | 'CANCELLED'
export type Verdict = 'RELEASE' | 'HOLD' | 'PENDING'
export type Stage = 'rules' | 'fuzzy' | 'llm' | 'review' | 'ignored' | 'fixed' | 'dismissed' | null

export interface Item {
  id: string
  code: string
  name: string
  price_centavos: number
  sizes: string[]
  stock: number
  keywords: string[]
  photo_url: string | null
  tone: string | null
  active?: boolean
}

export interface Order {
  id: string
  status: OrderStatus
  session_id: string
  item_id: string
  item_code: string
  item_name: string
  item_tone: string | null
  item_photo: string | null
  buyer_id: string
  buyer: string
  buyer_label: 'HOLD' | 'WATCH' | 'TRUSTED' | 'NEW'
  size: string | null
  qty: number
  unit_price_centavos: number
  total_centavos: number
  for_name: string | null
  claimed_at: string
  hold_until: string | null
  pay_by: string | null
  proof_reference: string | null
  proof_submitted_at: string | null
  proof_channel: 'manual' | 'qrph' | null
  proof_attested: boolean
  verdict: Verdict | null
  verdict_reasons: string[]
  verdict_suggestion: string | null
  seller_note: string | null
  buyer_token: string
  updated_at: string
}

export interface ParseResult {
  intent: string
  item_code: string | null
  size: string | null
  qty: number
  for_name?: string | null
  confidence: number
}

export interface Comment {
  id: string
  name: string
  message: string
  source: string
  created_time: string
  stage: Stage
  result: ParseResult | null
  confidence: number | null
  outcome: string | null
  resolved?: boolean
}

export interface BoardItem extends Item {
  claimed: Order[]
  confirmed: Order[]
  waitlist: Order[]
  ended: Order[]
  free_units: number
}

export interface Session {
  id: string
  title: string
  source: 'meta' | 'replay' | 'chat'
  live_video_id: string | null
  fb_video_url: string | null
  replay_speed: number
  status: 'idle' | 'running' | 'ended'
  error: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  current_item_id: string | null
  reader_running: boolean
  comments?: number
}

export interface Score {
  rules: number
  fuzzy: number
  llm: number
  review: number
  fixed: number
  ignored: number
  total: number
}

export interface Board {
  session: Session
  shop_name: string
  seller_name: string
  on_camera: BoardItem | null
  recent: BoardItem[]
  items: BoardItem[]
  review: Comment[]
  comments: Comment[]
  score: Score
  totals: { orders: number; value_centavos: number; waitlisted: number }
  llm: { enabled: boolean; model: string | null; last_ok: boolean | null; last_error: string | null }
  viewers: number
  camera_live: boolean
}

export interface SellerSettings {
  id: string
  name: string
  shop_name: string
  payment_mode: 'manual' | 'instant_qr' | 'both'
  wallet_provider: string
  wallet_name: string
  wallet_number: string
  auto_release_gateway: boolean
  hold_minutes: number
  pay_window_hours: number
  llm?: { enabled: boolean; model: string | null }
  meta_configured?: boolean
}

export interface BuyerOrder {
  status: OrderStatus
  shop_name: string
  seller_name: string
  session_title: string
  buyer_name: string
  item: { code: string; name: string; price_centavos: number; sizes: string[]; photo_url: string | null; tone: string | null }
  size: string | null
  qty: number
  total_centavos: number
  unit_price_centavos: number
  for_name: string | null
  claimed_at: string
  hold_until: string | null
  pay_by: string | null
  line_position: number | null
  payment: { mode: 'manual' | 'instant_qr' | 'both'; provider: string; name: string; number: string; seller_id: string }
  proof_reference: string | null
  proof_submitted_at: string | null
  proof_channel: 'manual' | 'qrph' | null
  checking: boolean
  seller_note: string | null
  qr: { intent_id: string; status: string; expires_at: string; amount_centavos: number } | null
  last_note: string | null
  server_now: string
}
