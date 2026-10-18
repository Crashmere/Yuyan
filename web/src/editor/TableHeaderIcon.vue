<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 24 })

// Exact 44x44 PNG supplied by the user (SHA-256 e7f981428788ed61376de7b4ab887121594d0f6090defa9308ca9237cded3757).
const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEwUlEQVR4Ae3AA6AkWZbG8f937o3IzKdyS2Oubdu2bdu2bdu2bWmMnpZKr54yMyLu+Xa3anqmhztr1a+21gyQmQDUWgGYpgmAWisAmckDRQQA0zQBUGsFYJomACKCB8pMAGqtAEzTBECtFYDM5IEiAoBpmgCotQJQ+d+Fyv8uVP53ofK/C5X/Xag8U0Tw/GQmz09m8vxEBM9PRPD8ZCbPT2byfFB5EXzrt30X3/xt38Xzk5kA1FoByExemIgAYJomACKCB/rgD3gfPvAD3ocXALXWzAvxrd/2XXzzt30X/5U++APehw/8gPfh+UCtNfNCvOwrvib/Hf7yT3+X54PKv8IHfcB78/zcfffd/OzP/wpv+eZvxPXXX8/zc/fdd/OzP/8rvOWbvxHXX389z8+3fNt38y+g8r8LleeSmQDUWnlRRAQRQWbSMvmXtEwyk1orAJnJCxMRAEzTBEDlfxcqzxQRAGQmD5SZAEQED5SZAEQEDxQRAGQmDxQRRATPLTMBiAgeKDMBiAgegMr/LlT+d6Hyr/AXf/FX3C/TANRauPPuewG4+657OXvfOQAykwe6+96zANx9173cfde91FoAmKYGQIR4EaDWmgEiAoBpmgCotQLwki/7qgBEBA+UmQDUWgGYpgmAWisAmckDRQQA0zQBUGsFYJomACKCB/rzP/5tAGqtAEzTBEDlX+Ev//R3uV9mAlBr5c//4q943w/4ML71m76GV36lVwAgM3mgv/yrv+EDP+Sj+NZv+hpe/uVehlorANM0ARARvOwrvib/AirPJTP5t8hMMpN/SWaSmfxrZSYAlf9dqDxTZgJQawUgMwGICJ6fiAAgM8lMaq3UWslMnp9pmpimib7v6fueYRgA6PsegMzkgWqtAAzDAEDf9wBU/nehZib/HhFBRBARRAQRwQNlJs9PRPCiiAgegMq/wp//xV/x3CKCv/zLvwbgL//yr3lumQnAX/7lXwPwl3/51wBM0wRArRWAzORFgGybF+JlX/E1AchMHigzeWEyE4BaKwCZCUCtFYBpmgCotQKQmTzQX//57wMwTRMAtVYAKv8K3/pNX8P9MpP7/eVf/jXf/G3fxQd/wPvwsi/70gBkJgC1VgD+/M//km/+tu/igz/gfXjZl31ppmkCoNYKQGbygR/yUfwLqMMwABARPD/TNAEQEbz8y70M94sI7ldr5du/6/t4xVd8eV7+5V6GB8pMADITgJd92Zfm5V/uZZimCYBaKwCZyYuAyv8u1L7veWEigucnMwHITKZpYpompmlimiYeKCIAiAgigueWmTw/mcnzQeV/F2pm8u8REUQEEUFEEBG8MJlJZhIRvCgiAoDMBKDyvwtqrZkX4mVf8TX57/CXf/q7PB8E/4IP/oD34b/aB3/A+/ACUCOCF+YDP+B9APjmb/sunp/M5IWJCB4oMwGotQKQmTzQB3/A+/CBH/A+3C8iAJimCQDZNi9EZvLCZCYvTETwQJkJQK0VgMzkhYkIAKZpAqAOwwBARPDCRAQPFBEARAQvTGYCEBEAZCYPlJkARAQPlJkARAQPQOV/F2rf97woMpMHmqaJFyYzAai18h+Iyv8u1GmaeGEigucnIgCICF6YzOQ/EJX/XfhHdqnZy+fobZIAAAAASUVORK5CYII='
</script>

<template>
  <img class="yy-table-header-icon" :src="source" :width="size" :height="size" alt="" aria-hidden="true" draggable="false" />
</template>

<style scoped>
.yy-table-header-icon {
  display: block;
  flex: none;
  pointer-events: none;
  user-select: none;
}
</style>
