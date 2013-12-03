// ==UserScript==
// @name        Trello Kanban WIP red colourisation
// @namespace   ip.trello
// @description A script that colours cards with too high or too low card limits red.
// @include     https://trello.com/b/*
// @version     3
// @grant       none
// ==/UserScript==

// access the real "window"
// http://stackoverflow.com/questions/5006460/userscripts-greasemonkey-calling-a-websites-javascript-functions
let exec = function(fn) {
  var script = document.createElement('script');
  script.setAttribute("type", "application/javascript");
  script.textContent = '(' + fn + ')();';
  document.body.appendChild(script); // run the script
  document.body.removeChild(script); // clean up
}

exec(function() {
  var load_js = function(src) {
    var script = document.createElement('script');
    script.setAttribute("type", "application/javascript");
    script.setAttribute("src", src);
    document.body.appendChild(script); // run the script
  }

  var load_css = function(src) {
    css_count = (typeof css_count == 'undefined' ? 0 : css_count) + 1;
    var link = document.createElement('link');
    link.setAttribute("id", "load-css" + css_count);
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("type", "text/css");
    link.setAttribute("href", src);
    link.setAttribute("media", "all");
    document.head.appendChild(link);
  }

  var instant_interval = 0; // [ms]
  var poll_interval = 5000; // [ms]

  var red_colour    = '#FF8282',
      gray_colour   = '#E3E3E3',
      orange_colour = '#F9DAB8';

  // Perform f(args) until f(args)=falsy.
  // The this-binding of the call is bound to the function f.
  // Basically a sliding scheduler function.
  // f: function to call, () -> boolish
  // initial_wait: how long to wait before calling f again.
  // period: how long to wait until calling f for the nth time.
  // args: optional args
  // returns: a Deferred that completes when f(args) returns false.
  var repeat_while = function(f, initial_wait, period, deferred, args) {
    var t = this;
    var deferred = (deferred || new jQuery.Deferred());
    setTimeout(function() {
      if (f.apply(t, args)) repeat_while.call(t, f, period, period, deferred, args);
      else deferred.resolve();
    }, initial_wait);
    return deferred;
  };

  // see 'repeat_while' with a negated predicate/f
  var repeat_until = function(f, initial_wait, period, args) {
    return repeat_while.call(this,
      function() !f.apply(this, arguments),
      instant_interval, period, null, args);
  };
  var wait_for = repeat_until;

  // Schedule a function to run forever, starting instantly.
  // The this-binding of the call to forever will be flowed to f.
  // f: the function to call.
  // period: how often to call the function.
  // args: optional arguments to f.
  // returns: a promise that never completes.
  var forever = function(f, initial_wait, period, args) {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/call
    return repeat_while.call(this,
      function() {
        f.apply(this, args);
        return true;
      },
      initial_wait, period, null, args);
  };
  
  var accept_move = function(ui, target) {
    console.debug('sender: ', ui.sender);
    console.debug('target: ', target);
    console.debug('all lists: ', $(ui.sender).closest('.list-area').find('> .list:not(.add-list)'));
    console.debug('sender green labels: ', $(ui.item).find('.green-label'));

    var $lists = $(ui.sender).closest('.list-area').find('> .list:not(.add-list)');
    var prev_index = $lists.index(ui.sender.closest('.list'));
    var index = $lists.index($(target).closest('.list'));
    console.debug('prev index: ', prev_index, ', index: ', index);
    return prev_index > index || $(ui.item).find('.green-label').length == 1
  };
  
  var handle_receive = function(evt, ui) {
    console.debug('got this: ', this, 'evt: ', evt, ', ui: ', ui);
    if (accept_move(ui, this)) {
      return;
    }
    else {
      $(ui.sender).sortable('cancel');
      var msg = 'Cannot move cards that are not "ready to pull". ' +
        'Add a green label to \'' + $.trim($(ui.item).find('a.list-card-title').text()) + '\' first.';
      Messenger().post({
        message: msg,
        type: 'error',
        showCloseButton: true });
      return false;
    }
  };

  jQuery.fn.extend({
    // function that takes the title of a list
    list_title : function() {
      return $(this).find("div[attr='name'] h2").text();
    }
  });

  var lists = function() {
    return $('#board .list:not(.add-list)');
  };

  var check = function($items) {
    return $items.
      map(function() {
        var title  = $(this).list_title();
        var actual = (/(\d+) cards/.exec($(this, '.num-cards').text()) || [0, 0])[1];
        var nums   = /\[(\d+)(?:-(\d+)){0,1}\]/.exec(title) || [-Infinity, 0, Infinity];
        return {
          "title"     : title,
          "min_lim"   : Number((!!nums[2]) ? nums[1] : 0),
          "max_lim"   : Number((!!nums[2]) ? nums[2] : nums[1]),
          "num_cards" : Number(actual || 0),
          "list"      : $(this)
        };
      }).get().
      reduce(function(acc, t, i, arr) {
        if (t.num_cards < t.min_lim || t.num_cards == t.max_lim) acc.orange.push(t);
        else if (t.num_cards > t.max_lim) acc.red.push(t);
        else acc.green.push(t);
        return acc;
      }, {red:[], green:[], orange:[]});
  };

  var update = function(rgs) {
    rgs.red.forEach(function(x) {
      //console.info("Consider the amount of work in '" + x.title +
      //  "'. You have " + x.num_cards +
      //  " cards there...");
      x.list.css("background", red_colour);
      x.list.find('.num-cards').css("color", "black").show();
    });
    rgs.green.forEach(function(x) {
      x.list.css("background", gray_colour);
      x.list.find('.num-cards').hide();
    });
    rgs.orange.forEach(function(x) {
      //console.info("Consider adding more work in '" + x.title +
      //  "' to improve throughput, you only have " + x.num_cards +
      //  " cards.");
      x.list.css("background", orange_colour);
    });
  };

  var check_n_update = function($items) {
    var $items = $items || lists();
    //console.debug('check_n_update called with ', $items);
    update(check($items));
  };

  var start_observing = function(lists, observer) {
    lists.each(function() {
      //console.debug('observing list ', $(this).list_title());
      observer.observe(this, { childList: true, subtree: true });
    });
  };

  // when the window is loaded;
  $(function() {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        var updated = $(mutation.target).closest('.list');
        check_n_update(updated);
      }, 1);
    });

    // load some nice message UI tools
    load_js('https://cdn.app.intelliplan.eu/dev/js/messenger.min.js');
    wait_for(function() typeof window.Messenger !== 'undefined', instant_interval, poll_interval).
      then(function() load_js('https://cdn.app.intelliplan.eu/dev/js/messenger-theme-future.js'));
    load_css('https://cdn.app.intelliplan.eu/dev/css/messenger.css');
    load_css('https://cdn.app.intelliplan.eu/dev/css/messenger-theme-future.css');

    wait_for(function() lists().length > 0, instant_interval, poll_interval).
      fail(function() console.debug('failed somehow')).
      then(function() {
        var ls = lists();
        start_observing(ls, observer);
        var _ = forever(check_n_update, instant_interval, poll_interval);
        ls.find('.ui-sortable').bind('sortreceive', handle_receive);
      });
  });
});
