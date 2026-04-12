"use client";

import axios from 'axios';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function startDiscordLink(authToken: string, nextPath: string = '/settings') {
  const response = await axios.get(`${API}/api/auth/discord/login/`, {
    params: { next: nextPath },
    headers: { Authorization: `Bearer ${authToken}` },
  });

  const authorizationUrl = response.data?.authorization_url;
  if (!authorizationUrl) {
    throw new Error('Discord authorization URL was not returned by the server.');
  }

  window.location.assign(authorizationUrl);
}