-- Each album on an order has a name, e.g. "Sadhan & Ashwini Wedding Album" or "Engagement Album".
alter table order_albums add column if not exists title text;
