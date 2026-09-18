// Skolix product lockup — ribbon mark + outlined wordmark (Bricolage Grotesque 700, opsz 96, tracked −1.5%).
// Self-contained (no font dependency). `color` = band colour; the fold is Marigold unless `mono`.
// `app` renders the app name after a thin divider, in the surrounding font.
export default function SkolixLockup({ app, color = '#4338CA', ink = 'currentColor', height = 22, mono = false, style, labelStyle }) {
  const h = height, w = h * (247.6 / 64)
  const fold = mono ? color : '#F6B73C'
  return (
    <span role="img" aria-label={app ? `Skolix ${app}` : 'Skolix'} style={{ display: 'inline-flex', alignItems: 'center', gap: h * 0.45, lineHeight: 1, ...style }}>
      <svg width={w} height={h} viewBox="0 0 247.6 64" aria-hidden style={{ display: 'block', overflow: 'visible', flex: 'none' }}>
        <g transform="translate(-20.245 -12.408) scale(1.30612)" fill="none" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M44 14 L20 24 L44 34 L20 44 L44 54" stroke={color} />
          <path d="M44 34 L20 44" stroke={fold} strokeOpacity={mono ? 0.55 : 1} />
        </g>
        <g transform="translate(63.10 53.12)" fill={ink}>
          <path transform="translate(0.00 0) scale(0.064000 -0.064000)" d="M328 -14Q263 -14 211.5 -1.5Q160 11 123.5 36.5Q87 62 66.5 100.5Q46 139 43 189L169 230Q171 185 191.5 155.0Q212 125 250.0 111.0Q288 97 335 97Q380 97 411.0 108.0Q442 119 458.0 137.5Q474 156 474 178Q474 204 454.0 220.0Q434 236 399.5 247.0Q365 258 321 268Q272 279 224.5 293.0Q177 307 138.5 329.0Q100 351 77.5 386.0Q55 421 55 474Q55 535 85.5 579.5Q116 624 175.0 649.0Q234 674 317 674Q401 674 460.5 649.5Q520 625 553.0 580.5Q586 536 589 475L459 439Q459 470 449.0 493.0Q439 516 421.0 531.5Q403 547 376.5 555.0Q350 563 316 563Q277 563 248.5 553.0Q220 543 205.5 526.0Q191 509 191 486Q191 459 213.5 441.5Q236 424 273.5 413.0Q311 402 356 392Q399 383 443.5 369.5Q488 356 526.5 334.5Q565 313 588.5 276.5Q612 240 612 185Q612 125 580.0 80.0Q548 35 484.5 10.5Q421 -14 328 -14Z"/><path transform="translate(40.77 0) scale(0.064000 -0.064000)" d="M66 0V715H208V318Q239 339 267.5 363.5Q296 388 319.5 415.0Q343 442 361.5 470.0Q380 498 393 525H558Q543 487 518.5 448.5Q494 410 460.5 377.5Q427 345 383.0 322.0Q339 299 286 291V274Q353 286 397.0 272.0Q441 258 469.5 227.5Q498 197 515.0 157.5Q532 118 546 78L569 0H412L399 49Q385 98 368.0 135.0Q351 172 323.5 192.5Q296 213 248 213H208V0Z"/><path transform="translate(77.63 0) scale(0.064000 -0.064000)" d="M304 -14Q225 -14 165.0 17.5Q105 49 71.0 110.5Q37 172 37 264Q37 356 71.5 417.0Q106 478 166.5 508.5Q227 539 304 539Q383 539 443.5 508.0Q504 477 538.5 415.5Q573 354 573 262Q573 169 537.5 107.5Q502 46 441.5 16.0Q381 -14 304 -14ZM309 93Q348 93 374.5 111.0Q401 129 414.5 165.5Q428 202 428 254Q428 309 413.5 347.5Q399 386 371.0 406.5Q343 427 300 427Q263 427 236.0 409.5Q209 392 195.0 355.5Q181 319 181 266Q181 181 215.0 137.0Q249 93 309 93Z"/><path transform="translate(115.65 0) scale(0.064000 -0.064000)" d="M66 0V715H208V0Z"/><path transform="translate(132.22 0) scale(0.064000 -0.064000)" d="M66 0V525H210V0ZM139 604Q97 604 74.5 621.5Q52 639 52 673Q52 708 74.5 726.0Q97 744 139 744Q182 744 204.5 726.0Q227 708 227 673Q227 640 204.5 622.0Q182 604 139 604Z"/><path transform="translate(148.99 0) scale(0.064000 -0.064000)" d="M14 0 188 263 14 525H180L276 327H293L389 525H554L380 263L556 0H391L293 199H276L180 0Z"/>
        </g>
      </svg>
      {app && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: h * 0.45 }}>
          <span aria-hidden style={{ width: 1, height: h * 0.8, background: 'currentColor', opacity: 0.3 }} />
          <span style={{ fontSize: h * 0.62, fontWeight: 600, letterSpacing: '0.01em', opacity: 0.85, ...labelStyle }}>{app}</span>
        </span>
      )}
    </span>
  )
}
