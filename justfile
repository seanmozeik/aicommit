default:
	@just --list

check:
	bun run check

test:
	bun test

dev:
	bun run dev

build:
	bun run build

lint:
	bun run lint

format:
	bun run format

typecheck:
	bun run typecheck
