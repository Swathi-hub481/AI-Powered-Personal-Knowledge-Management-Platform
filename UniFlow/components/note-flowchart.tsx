"use client";

import { useMemo, useState } from "react";

interface TreeNode {
	id: string;
	label: string;
	level: number;       // 0 = root, 1 = section, 2 = subsection
	charOffset: number;
	children: TreeNode[];
}

interface PositionedNode {
	id: string;
	label: string;
	level: number;
	charOffset: number;
	cx: number;        // horizontal center
	y: number;         // top edge
	w: number;
	h: number;
	parentId: string | null;
}

const NODE_W = 176;
const NODE_H = 40;
const H_GAP = 20;
const V_GAP = 64;
const PADDING = 32;

const COLORS = {
	0: { bg: "#f0fdf4", stroke: "#16a34a", text: "#15803d" },
	1: { bg: "#eff6ff", stroke: "#3b82f6", text: "#1d4ed8" },
	2: { bg: "#faf5ff", stroke: "#a855f7", text: "#7e22ce" },
} as const;

function shorten(text: string, max = 24): string {
	const clean = text.replace(/[*_`#]/g, "").trim();
	return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}

// H2 headings become top-level sections; H3 headings nest under their parent H2.
function buildTreeFromHeadings(content: string, labelMap: Map<string, string>): TreeNode | null {
	const lines = content.split("\n");
	let offset = 0;
	let counter = 0;
	const makeId = () => `n${counter++}`;

	type Heading = { mdLevel: 1 | 2 | 3; label: string; offset: number };
	const headings: Heading[] = [];

	for (const line of lines) {
		const m3 = line.match(/^###\s+(.+)/);
		const m2 = !m3 && line.match(/^##\s+(.+)/);
		const m1 = !m2 && !m3 && line.match(/^#\s+(.+)/);
		if (m3) headings.push({ mdLevel: 3, label: m3[1].trim(), offset });
		else if (m2) headings.push({ mdLevel: 2, label: m2[1].trim(), offset });
		else if (m1) headings.push({ mdLevel: 1, label: m1[1].trim(), offset });
		offset += line.length + 1;
	}

	if (headings.length === 0) return null;

	// A lone leading H1 becomes the root; otherwise create a virtual "Overview" root
	let startIdx = 0;
	let rootLabel = labelMap.get("overview") ?? "Overview";
	let rootOffset = 0;
	if (headings[0].mdLevel === 1) {
		rootLabel = labelMap.get(headings[0].label.toLowerCase()) ?? shorten(headings[0].label, 30);
		rootOffset = headings[0].offset;
		startIdx = 1;
	}

	const root: TreeNode = { id: makeId(), label: rootLabel, level: 0, charOffset: rootOffset, children: [] };
	let currentSection: TreeNode | null = null;

	for (let i = startIdx; i < headings.length; i++) {
		const h = headings[i];
		const node: TreeNode = {
			id: makeId(),
			label: labelMap.get(h.label.toLowerCase()) ?? shorten(h.label),
			level: h.mdLevel <= 2 ? 1 : 2,
			charOffset: h.offset,
			children: [],
		};
		if (h.mdLevel <= 2) {
			root.children.push(node);
			currentSection = node;
		} else {
			(currentSection ?? root).children.push(node);
		}
	}

	return root.children.length > 0 ? root : null;
}

// clusters. Each cluster's label comes from the first few words of its opening
function buildTreeFromParagraphs(content: string): TreeNode | null {
	interface Block { text: string; offset: number }
	const blocks: Block[] = [];
	let pos = 0;
	for (const raw of content.split(/\n{2,}/)) {
		const trimmed = raw.trim();
		if (trimmed.length > 0) blocks.push({ text: trimmed, offset: pos });
		pos += raw.length + 2;
	}
	if (blocks.length === 0) return null;

	let counter = 0;
	const makeId = () => `n${counter++}`;
	const rootLabel = shorten(blocks[0].text.split(/[.!?]/)[0].trim(), 28) || "Overview";
	const root: TreeNode = { id: makeId(), label: rootLabel, level: 0, charOffset: blocks[0].offset, children: [] };

	if (blocks.length === 1) return root;

	// Group remaining blocks into 2–5 clusters based on content volume
	const rest = blocks.slice(1);
	const targetGroups = Math.min(5, Math.max(2, Math.round(rest.length / 3)));
	const perGroup = Math.ceil(rest.length / targetGroups);

	for (let i = 0; i < rest.length; i += perGroup) {
		const group = rest.slice(i, i + perGroup);
		const words = group[0].text.replace(/[*_`#]/g, "").split(/\s+/).slice(0, 6).join(" ");
		root.children.push({
			id: makeId(),
			label: shorten(words, 24),
			level: 1,
			charOffset: group[0].offset,
			children: [],
		});
	}
	return root;
}

function parseFlowTree(content: string, labelMap: Map<string, string>): TreeNode | null {
	return buildTreeFromHeadings(content, labelMap) ?? buildTreeFromParagraphs(content);
}

// Computes the minimum horizontal space a subtree requires.
function subtreeWidth(node: TreeNode): number {
	if (node.children.length === 0) return NODE_W;
	const total =
		node.children.reduce((s, c) => s + subtreeWidth(c), 0) +
		H_GAP * (node.children.length - 1);
	return Math.max(NODE_W, total);
}

// Recursively assigns (cx, y) positions to every node.
function positionTree(
	node: TreeNode,
	centerX: number,
	y: number,
	parentId: string | null,
	out: PositionedNode[],
) {
	out.push({ id: node.id, label: node.label, level: node.level, charOffset: node.charOffset, cx: centerX, y, w: NODE_W, h: NODE_H, parentId });
	if (node.children.length === 0) return;
	const totalW =
		node.children.reduce((s, c) => s + subtreeWidth(c), 0) +
		H_GAP * (node.children.length - 1);
	let cx = centerX - totalW / 2;
	for (const child of node.children) {
		const sw = subtreeWidth(child);
		positionTree(child, cx + sw / 2, y + NODE_H + V_GAP, node.id, out);
		cx += sw + H_GAP;
	}
}

interface NoteFlowchartProps {
	content: string;
	flowNodes?: { headingText: string; label: string }[];
	onNodeClick: (charOffset: number) => void;
}

export function NoteFlowchart({ content, flowNodes, onNodeClick }: NoteFlowchartProps) {
	const [hovered, setHovered] = useState<string | null>(null);

	const labelMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const fn of (flowNodes ?? [])) {
			m.set(fn.headingText.toLowerCase().trim(), fn.label.trim());
		}
		return m;
	}, [flowNodes]);

	const positioned = useMemo<PositionedNode[]>(() => {
		const tree = parseFlowTree(content, labelMap);
		if (!tree) return [];
		const out: PositionedNode[] = [];
		positionTree(tree, PADDING + subtreeWidth(tree) / 2, PADDING, null, out);
		return out;
	}, [content, labelMap]);

	if (positioned.length === 0) {
		return (
			<div className="flex items-center justify-center h-28 text-sm text-gray-400 dark:text-slate-500">
				No content to visualize yet.
			</div>
		);
	}

	const byId = Object.fromEntries(positioned.map((n) => [n.id, n]));
	const svgW = Math.max(...positioned.map((n) => n.cx + n.w / 2)) + PADDING;
	const svgH = Math.max(...positioned.map((n) => n.y + n.h)) + PADDING;

	return (
		<div className="overflow-auto w-full">
			<svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="block">
				<defs>
					<marker id="fc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
						<path d="M0,0 L0,6 L8,3 z" fill="#cbd5e1" />
					</marker>
				</defs>

				{/* Edges */}
				{positioned.map((node) => {
					if (!node.parentId) return null;
					const parent = byId[node.parentId];
					if (!parent) return null;
					const x1 = parent.cx, y1 = parent.y + parent.h;
					const x2 = node.cx, y2 = node.y;
					const midY = (y1 + y2) / 2;
					return (
						<path
							key={`e-${node.id}`}
							d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
							stroke="#cbd5e1"
							strokeWidth="1.5"
							fill="none"
							markerEnd="url(#fc-arrow)"
						/>
					);
				})}

				{/* Nodes */}
				{positioned.map((node) => {
					const colorKey = Math.min(node.level, 2) as 0 | 1 | 2;
					const { bg, stroke, text } = COLORS[colorKey];
					const isHov = hovered === node.id;
					return (
						<g
							key={node.id}
							style={{ cursor: "pointer" }}
							onMouseEnter={() => setHovered(node.id)}
							onMouseLeave={() => setHovered(null)}
							onClick={() => onNodeClick(node.charOffset)}
						>
							<rect
								x={node.cx - node.w / 2}
								y={node.y}
								width={node.w}
								height={node.h}
								rx={9}
								fill={isHov ? stroke : bg}
								stroke={stroke}
								strokeWidth={isHov ? 2 : 1.5}
							/>
							<text
								x={node.cx}
								y={node.y + node.h / 2}
								textAnchor="middle"
								dominantBaseline="middle"
								fontFamily="inherit"
								fontSize={node.level === 0 ? 14 : 13}
								fontWeight={node.level === 0 ? 700 : node.level === 1 ? 500 : 400}
								fill={isHov ? "#fff" : text}
								style={{ pointerEvents: "none", userSelect: "none" }}
							>
								{node.label}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}

