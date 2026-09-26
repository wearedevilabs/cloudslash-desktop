# CloudSlash build targets.
#
#   make build             build the CLI          -> bin/cloudslash
#   make desktop           build the desktop app  -> bin/cloudslash-desktop
#   make desktop-frontend  bundle the interface only
#   make desktop-test      run the desktop service tests
#   make desktop-verify    audit the interface layout in a headless browser
#   make test              run the test suite
#   make vet               run go vet
#   make fmt               format all Go source
#   make run-demo          run a headless demo scan (no AWS account needed)
#   make clean             remove build output
#
# The desktop app embeds its interface bundle, so `make desktop` builds the
# frontend first. That needs Node and the platform GUI toolchain: on Linux,
# gtk4 and webkitgtk-6.0 development headers.

VERSION ?= $(shell cat VERSION 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/DrSkyle/cloudslash/v2/pkg/version.Current=$(VERSION)
GOARGS ?=
FRONTEND := cmd/cloudslash-desktop/frontend

.PHONY: all build cli desktop desktop-frontend desktop-test desktop-verify desktop-run test vet fmt tidy run-demo clean

all: build desktop

## build: compile the CLI (aka `make cli`)
build: cli

cli:
	@mkdir -p bin
	go build $(GOARGS) -ldflags "$(LDFLAGS)" -o bin/cloudslash ./cmd/cloudslash-cli
	@echo "built bin/cloudslash ($(VERSION))"

## desktop: bundle the interface, then compile the desktop application
desktop: desktop-frontend
	@mkdir -p bin
	go build $(GOARGS) -tags production -ldflags "$(LDFLAGS)" -o bin/cloudslash-desktop ./cmd/cloudslash-desktop
	@echo "built bin/cloudslash-desktop ($(VERSION))"

## desktop-frontend: build the interface bundle that main.go embeds
desktop-frontend:
	@echo "bundling the interface…"
	@cd $(FRONTEND) && npm install --include=dev --no-audit --no-fund && npm run build

## desktop-test: exercise the desktop service (scan, export, allowlists, prefs)
desktop-test:
	go test $(GOARGS) ./cmd/cloudslash-desktop/...

## desktop-verify: check layout, contrast and typography across every screen
#  Serves the built bundle on loopback, drives it in headless Chromium, and
#  fails on clipped text, overlapping elements, low contrast or missing copy.
#  Needs chromium, and a POSIX shell for the throwaway static server.
desktop-verify: desktop-frontend
	@cd $(FRONTEND) && ./node_modules/.bin/tsc --noEmit
	@cd $(FRONTEND)/dist && python3 -m http.server 8095 --bind 127.0.0.1 >/dev/null 2>&1 & \
	 server=$$!; \
	 sleep 1; \
	 cd $(FRONTEND) && npm run verify --silent -- --url http://127.0.0.1:8095 --out .verify; \
	 status=$$?; \
	 kill $$server 2>/dev/null; \
	 exit $$status

test:
	go test $(GOARGS) ./pkg/... ./cmd/...

vet:
	go vet $(GOARGS) ./...

fmt:
	gofmt -w $$(find cmd pkg -name '*.go' -type f)

tidy:
	go mod tidy

## run-demo: headless scan against synthetic data
run-demo: cli
	./bin/cloudslash scan --mock --headless

## desktop-run: build and launch the desktop app
desktop-run: desktop
	./bin/cloudslash-desktop

clean:
	rm -rf bin cloudslash-out cmd/cloudslash-desktop/frontend/dist
