.PHONY:  web build linux dev

web:
	npm --prefix web run build

build: web
	go build -trimpath -o bin/yuyan ./cmd/yuyan

linux: web
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o bin/yuyan-linux-amd64 ./cmd/yuyan

dev: build
	@test -f .local/data/yuyan.db || bin/yuyan init --data .local/data
	bin/yuyan serve --data .local/data --with-prefix


.PHONY: release deploy portal rollback releases
release:
	bash deploy/release.sh build
deploy:
	bash deploy/release.sh deploy
portal:
	bash deploy/release.sh portal
rollback:
	bash deploy/release.sh rollback $(COMMIT)
releases:
	bash deploy/release.sh list
