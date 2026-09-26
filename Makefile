.PHONY: test web build linux dev parity e2e

test:
	npm --prefix web test
	npm --prefix web run typecheck
	go test ./...
	go vet ./...

web:
	npm --prefix web run build

build: web
	go build -trimpath -o bin/yuyan ./cmd/yuyan

linux: web
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o bin/yuyan-linux-amd64 ./cmd/yuyan

dev: build
	@test -f .local/data/yuyan.db || bin/yuyan init --data .local/data
	bin/yuyan serve --data .local/data --with-prefix

parity:
	npm --prefix web run parity

# Browser smoke tests; needs `npx --prefix web playwright install chromium` once.
e2e: build
	npm --prefix web run e2e
