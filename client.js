/**
 * dsh-git-change — client half.
 *
 * Hand-written bundle (no build step): the DSH module loader only needs a
 * registered factory that RETURNS its exports; everything else is plain CJS
 * over the frozen platform table (`react`).
 *
 * The badge lives in `conversation.input.right`, rendered by the conversation
 * InputBar inside its right-hand cluster immediately before the model
 * selector — 12px to its left, sliding with the model name's width.
 */
window.__ModuleLoader__.load({
	id: 'dsh-git-change',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		const React = require('react')
		const h = React.createElement
		const CHANNEL = '/dsh-git-change'
		const ICON_SIZE = 14
		const CURRENT = 'currentColor'

		const TOOLTIP_STYLE = {
			position: 'absolute',
			bottom: 'calc(100% + 8px)',
			left: '50%',
			transform: 'translateX(-50%)',
			zIndex: 60,
			boxSizing: 'border-box',
			minWidth: 128,
			padding: '10px 12px',
			borderRadius: 10,
			border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))',
			background: 'var(--dsw-specific-menu, #ffffff)',
			boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
			whiteSpace: 'nowrap',
			pointerEvents: 'none',
			textAlign: 'left',
		}
		const BRANCH_ROW_STYLE = {
			display: 'flex',
			alignItems: 'center',
			gap: 6,
			fontSize: 13,
			fontWeight: 600,
			lineHeight: '18px',
			color: 'var(--dsw-alias-label-primary, #0f1115)',
		}
		const MUTED_ROW_STYLE = {
			marginTop: 4,
			fontSize: 12,
			lineHeight: '18px',
			color: 'var(--dsw-alias-label-tertiary, #81858c)',
		}
		const COUNT_ROW_STYLE = {
			marginTop: 2,
			display: 'flex',
			gap: 10,
			fontSize: 12,
			lineHeight: '18px',
			fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
		}
		const ADDED_STYLE = { color: 'var(--dsw-alias-state-success-primary, #1a7f37)' }
		const DELETED_STYLE = { color: 'var(--dsw-alias-state-error-primary, #cf222e)' }
		const BADGE_STYLE = {
			position: 'relative',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			height: 28,
			color: 'var(--dsw-alias-label-tertiary, #81858c)',
		}

		/** Git branch glyph on a 16-unit grid, stroked in currentColor. */
		function GitIcon(props) {
			const size = props && props.size ? props.size : ICON_SIZE
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					xmlns: 'http://www.w3.org/2000/svg',
					'aria-hidden': 'true',
					style: { display: 'block' },
				},
				h('path', {
					key: 'trunk',
					d: 'M5.6 6.1V9.9',
					stroke: CURRENT,
					strokeWidth: 1.5,
					strokeLinecap: 'round',
				}),
				h('path', {
					key: 'branch',
					d: 'M5.6 8.6C8.8 8.6 12.4 9.2 12.4 8.4',
					stroke: CURRENT,
					strokeWidth: 1.5,
					strokeLinecap: 'round',
				}),
				h('circle', { key: 'a', cx: 5.6, cy: 3.9, r: 1.9, stroke: CURRENT, strokeWidth: 1.4 }),
				h('circle', { key: 'b', cx: 5.6, cy: 12.1, r: 1.9, stroke: CURRENT, strokeWidth: 1.4 }),
				h('circle', { key: 'c', cx: 12.4, cy: 6.6, r: 1.9, stroke: CURRENT, strokeWidth: 1.4 }),
			)
		}

		function BadgeTooltip(props) {
			const status = props.status
			const files = status.filesChanged
			const rows = [
				h(
					'div',
					{ key: 'branch', style: BRANCH_ROW_STYLE },
					h(GitIcon, { size: ICON_SIZE }),
					h('span', null, status.branch || 'HEAD'),
				),
				h(
					'div',
					{ key: 'files', style: MUTED_ROW_STYLE },
					files === 1 ? '1 file changed' : String(files) + ' files changed',
				),
				h(
					'div',
					{ key: 'counts', style: COUNT_ROW_STYLE },
					h('span', { style: ADDED_STYLE }, '+' + status.added),
					h('span', { style: DELETED_STYLE }, '-' + status.deleted),
				),
			]
			if (status.truncated) {
				rows.push(h('div', { key: 'truncated', style: MUTED_ROW_STYLE }, '未跟踪文件过多，统计已截断'))
			}
			return h('div', { style: TOOLTIP_STYLE, role: 'tooltip' }, rows)
		}

		function GitBadge(props) {
			const sessionId = props.sessionId
			const connection = props.connection
			const useSessionStatus = props.useSessionStatus
			const [status, setStatus] = React.useState(null)
			const [open, setOpen] = React.useState(false)
			const [nonce, setNonce] = React.useState(0)

			const selectStatus = React.useCallback(
				(snapshot) => (sessionId === undefined ? undefined : snapshot.get(sessionId)),
				[sessionId],
			)
			const sessionStatus =
				typeof useSessionStatus === 'function' ? useSessionStatus(selectStatus) : undefined

			React.useEffect(() => {
				if (sessionId === undefined || connection === undefined) return undefined
				let alive = true
				connection.rpc
					.call(CHANNEL, 'status', { sessionId })
					.then((response) => {
						if (!alive) return
						setStatus(response && response.ok === true ? response.value : null)
					})
					.catch(() => {
						if (alive) setStatus(null)
					})
				return () => {
					alive = false
				}
			}, [sessionId, connection, sessionStatus, nonce])

			if (status === null || status === undefined || status.isRepo !== true) return null

			return h(
				'div',
				{
					style: BADGE_STYLE,
					onMouseEnter: () => {
						setOpen(true)
						setNonce((value) => value + 1)
					},
					onMouseLeave: () => setOpen(false),
				},
				h(
					'span',
					{
						style: { display: 'flex', alignItems: 'center' },
						role: 'img',
						'aria-label': 'git: ' + (status.branch || 'HEAD'),
					},
					h(GitIcon, { size: ICON_SIZE }),
				),
				open ? h(BadgeTooltip, { status }) : null,
			)
		}

		function apply(ctx) {
			ctx.slots.inject('conversation.input.right', () =>
				ctx.slots.register(
					{
						name: 'conversation.input.right',
						id: 'dsh-git-change/badge',
						inject: (sessionId) => ({ sessionId, connection: ctx.connection }),
					},
					GitBadge,
				),
			)
		}

		exports.name = 'dsh-git-change'
		exports.apply = apply
		exports.inject = ['slots', 'connection']
		return module.exports
	},
})
