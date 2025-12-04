#ifdef PHP_WASM_USE_NODE_DNS

/*
 * Provide a Node-backed gethostbyname() that resolves hostnames using the
 * native dns module instead of Emscripten's synthetic DNS mapping. This is
 * enabled only for the Node build via PHP_WASM_USE_NODE_DNS.
 */

#include <arpa/inet.h>
#include <emscripten.h>
#include <netdb.h>
#include <string.h>

#  ifdef PLAYGROUND_JSPI
EM_ASYNC_JS(int, wasm_node_dns_lookup, (const char *name, char *out, int out_len), {
        const returnCallback = (resolver) => new Promise(resolver);
#  else
EM_JS(int, wasm_node_dns_lookup, (const char *name, char *out, int out_len), {
        const returnCallback = (resolver) => Asyncify.handleSleep(resolver);
#  endif
        return returnCallback(async (wakeUp) => {
                try {
                        const dns = require('dns').promises;
                        const host = UTF8ToString(name);
                        const { address } = await dns.lookup(host, { family: 4 });
                        const required = lengthBytesUTF8(address) + 1;
                        if (required > out_len) {
                                wakeUp(-required);
                                return;
                        }
                        stringToUTF8(address, out, out_len);
                        wakeUp(required);
                } catch (e) {
                        wakeUp(0);
                }
        });
});

static struct hostent *node_dns_gethostbyname(const char *name)
{
        static struct hostent h;
        static char *aliases[1];
        static char *addr_list[2];
        static struct in_addr addr;
        static char name_buf[256];

        memset(&h, 0, sizeof(h));
        aliases[0] = NULL;
        addr_list[0] = NULL;
        addr_list[1] = NULL;

        char ip[64];
        int n = wasm_node_dns_lookup(name, ip, sizeof(ip));
        if (n <= 0) {
#ifdef h_errno
                h_errno = HOST_NOT_FOUND;
#endif
                return NULL;
        }

        if (!inet_aton(ip, &addr)) {
#ifdef h_errno
                h_errno = NO_RECOVERY;
#endif
                return NULL;
        }

        strncpy(name_buf, name, sizeof(name_buf) - 1);
        name_buf[sizeof(name_buf) - 1] = '\0';

        h.h_name = name_buf;
        h.h_aliases = aliases;
        h.h_addrtype = AF_INET;
        h.h_length = sizeof(struct in_addr);
        addr_list[0] = (char *)&addr;
        h.h_addr_list = addr_list;

        return &h;
}

struct hostent *gethostbyname(const char *name)
{
        return node_dns_gethostbyname(name);
}

#endif
