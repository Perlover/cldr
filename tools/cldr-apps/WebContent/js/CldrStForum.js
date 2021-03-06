'use strict';

/**
 * cldrStForum: encapsulate main Survey Tool Forum code.
 *
 * Use an IIFE pattern to create a namespace for the public functions,
 * and to hide everything else, minimizing global scope pollution.
 * Ideally this should be a module (in the sense of using import/export),
 * but not all Survey Tool JavaScript code is capable yet of being in modules
 * and running in strict mode.
 *
 * Dependencies on external code:
 * window.surveyCurrentLocale, window.surveySessionId, window.surveyUser, window.locmap,
 * createGravitar, stui.str, listenFor, bootstrap.js, reloadV, contextPath,
 * surveyCurrentSpecial, showInPop2, hideLoader, ...!
 *
 * TODO: possibly move these functions here from survey.js: showForumStuff, havePosts, updateInfoPanelForumPosts, appendForumStuff;
 * also some/all code from forum.js
 */
const cldrStForum = (function() {

	const FORUM_DEBUG = false;

	function forumDebug(s) {
		if (FORUM_DEBUG) {
			console.log(s);
		}
	}

	/**
	 * The locale, like "fr_CA", for which to show Forum posts.
	 * This module has persistent data for only one locale at a time, except that sublocales may be
	 * combined, such as "fr_CA" combined with "fr".
	 * Caution: the locale for a reply must exactly match the locale for the post to which it's a reply,
	 * so the locale for a particular post might for example be "fr" even though forumLocale is "fr_CA",
	 * or vice-versa.
	 */
	let forumLocale = null;

	/**
	 * The time when the posts were last updated from the server
	 */
	let forumUpdateTime = null;

	/**
	 * Mapping from post id to post object, describing the most recently parsed
	 * full set of posts from the server
	 */
	let postHash = {};

	/**
	 * Fetch the Forum data from the server, and "load" it
	 *
	 * @param locale the locale string, like "fr_CA" (surveyCurrentLocale)
	 * @param forumMessage the forum message
	 * @param params an object with various properties such as exports, special, flipper, otherSpecial, name, ...
	 */
	function loadForum(locale, forumMessage, params) {
		setLocale(locale);
		const url = getLoadForumUrl();
		const errorHandler = function(err) {
			// const responseText = cldrStAjax.errResponseText(err);
			params.special.showError(params, null, {err: err, what: "Loading forum data"});
		};
		const loadHandler = function(json) {
			if (json.err) {
				if (params.special) {
					params.special.showError(params, json, {what: "Loading forum data"});
				}
				return;
			}
			// set up the 'right sidebar'
			showInPop2(forumStr(params.name + "Guidance"), null, null, null, true); /* show the box the first time */

			const ourDiv = document.createElement("div");
			ourDiv.appendChild(forumCreateChunk(forumMessage, "h4", ""));

			const filterMenu = cldrStForumFilter.createMenu(reloadV);
			const summaryDiv = document.createElement("div");
			summaryDiv.innerHTML = '';
			ourDiv.appendChild(summaryDiv);
			ourDiv.appendChild(filterMenu);
			ourDiv.appendChild(document.createElement('hr'));
			const posts = json.ret;
			if (posts.length == 0) {
				ourDiv.appendChild(forumCreateChunk(forumStr("forum_noposts"), "p", "helpContent"));
			} else {
				const content = parseContent(posts, 'main');
				ourDiv.appendChild(content);
				summaryDiv.innerHTML = getForumSummaryHtml(forumLocale); // after parseContent
			}
			// No longer loading
			hideLoader(null);
			params.flipper.flipTo(params.pages.other, ourDiv);
			params.special.handleIdChanged(surveyCurrentId); // rescroll.
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Make a new forum post or a reply.
	 *
	 * @param params the object containing various parameters: locale, xpath, replyTo, replyData, ...
	 */
	function openPostOrReply(params) {
		const isReply = (params.replyTo && params.replyTo >= 0) ? true : false
		const replyTo = isReply ? params.replyTo : -1;
		const parentPost = (isReply && params.replyData) ? params.replyData : null;
		const firstPost = parentPost ? getFirstPostInThread(parentPost) : null;
		const locale = isReply ? firstPost.locale : (params.locale ? params.locale : '');
		const xpath = isReply ? firstPost.xpath : (params.xpath ? params.xpath : '');
		const subjectParam = params.subject ? params.subject : '';
		const html = makePostHtml(isReply, firstPost, locale, xpath, replyTo);
		const subject = makePostSubject(isReply, parentPost, subjectParam);

		openPostWindow(subject, html, parentPost);
	}

	/**
	 * Assemble the form and related html elements for creating a forum post
	 *
	 * @param isReply is this a reply? True or false
	 * @param firstPost the original post in the thread
	 * @param locale the locale string
	 * @param xpath the xpath string
	 * @param replyTo the post id of the post being replied to, or -1
	 */
	function makePostHtml(isReply, firstPost, locale, xpath, replyTo) {
		let html = '';

		html += '<form role="form" id="post-form">';
		html += '<div class="form-group">';
		html += '<div class="input-group"><span class="input-group-addon">Subject:</span>';
		html += '<input class="form-control" name="subj" type="text" value=""></div>';
		html += '<textarea name="text" class="form-control" placeholder="Write your post here"></textarea></div>';
		html += postStatusMenu(isReply, firstPost);
		html += '<button class="btn btn-success submit-post btn-block">Submit</button>';
		html += '<input type="hidden" name="forum" value="true">';
		html += '<input type="hidden" name="_" value="' + locale + '">';
		html += '<input type="hidden" name="xpath" value="' + xpath + '">';
		html += '<input type="hidden" name="replyTo" value="' + replyTo + '">';
		html += '</form>';

		html += '<div class="post"></div>';
		html += '<div class="forumDiv"></div>';

		return html;
	}

	/**
	 * Make the subject string for a forum post
	 *
	 * @param isReply is this a reply? True or false
	 * @param parentPost the post object for the post being replied to, or null
	 * @param subjectParam the subject for this post supplied in parameters
	 * @return the string
	 */
	function makePostSubject(isReply, parentPost, subjectParam) {
		if (isReply && parentPost) {
			let subject = post2text(parentPost.subject);
			if (subject.substring(0, 3) != 'Re:') {
				subject = 'Re: ' + subject;
			}
			return subject;
		}
		return subjectParam;
	}

	/**
	 * Get the html content for the Status menu
	 *
	 * @param isReply true if this post is a reply, else false
	 * @param firstPost the original post in the thread
	 * @return the html
	 *
	 * Compare SurveyForum.ForumStatus on server
	 */
	function postStatusMenu(isReply, firstPost) {
		let content = '<p id="forum-status-area">Status: ';

		content += '<select id="forum-status-menu" required>\n';
		content += '<option value="" disabled selected>Select one</option>\n';

		if (!isReply) {
			content += '<option value="Request">Request a change</option>\n';
		}
		content += '<option value="Question">Ask a question</option>\n';
		if (isReply) {
			content += '<option value="Information">Information</option>\n';
		}
		if (isReply && firstPost && !userIsPoster(firstPost) && firstPost.status === 'Request') {
			content += '<option value="Agreed">Agree</option>\n';
			content += '<option value="Disputed">Disagree</option>\n';
		}
		if (canUserClose(isReply, firstPost)) {
			content += '<option value="Closed">Close</option>\n';
		}
		content += '</select></p>\n';
		return content;
	}

	/**
	 * Is this user allowed to close the thread now?
	 *
	 * The user is only allowed if they are the original poster of the thread,
	 * or a TC (technical committee) member.
	 *
	 * @param isReply true if this post is a reply, else false
	 * @param firstPost the original post in the thread, or null
	 * @return true if this user is allowed to close, else false
	 */
	function canUserClose(isReply, firstPost) {
		return isReply && (userIsPoster(firstPost) || userIsTC());
	}

	/**
	 * Is the current user the poster of this post?
	 *
	 * @param post the post, or null
	 * @returns true or false
	 */
	function userIsPoster(post) {
		if (post && typeof surveyUser !== 'undefined') {
			if (surveyUser === post.poster) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Is the current user a TC (Technical Committee) member?
	 *
	 * @returns true or false
	 */
	function userIsTC() {
		if (typeof surveyUserPerms !== 'undefined' && surveyUserPerms.userIsTC) {
			return true;
		}
		return false;
	}

	/**
	 * Open a window displaying the form for creating a post
	 *
	 * @param subject the subject string
	 * @param html the main html for the form
	 * @param parentPost the post object, if any, to which this is a reply, for display at the bottom of the window
	 *
	 * Reference: Bootstrap.js post-modal: https://getbootstrap.com/docs/4.1/components/modal/
	 */
	function openPostWindow(subject, html, parentPost) {
		const postModal = $('#post-modal');
		postModal.find('.modal-body').html(html);
		postModal.find('input[name=subj]')[0].value = subject;

		if (parentPost) {
			const forumDiv = parseContent([parentPost], 'new');
			const postHolder = postModal.find('.modal-body').find('.forumDiv');
			postHolder[0].appendChild(forumDiv);
		}
		postModal.modal();
		postModal.find('textarea').autosize();
		postModal.find('.submit-post').click(submitPost);
		setTimeout(function() {
			postModal.find('textarea').focus();
		}, 1000 /* one second */);
	}

	/**
	 * Submit a forum post
	 *
	 * @param event
	 */
	function submitPost(event) {
		const forumStatus = document.getElementById('forum-status-menu').value;
		if (!forumStatus) {
			/*
			 * Normally this won't happen, since the menu has the attribute "required".
			 * The browser should prevent the form from being submitted, and it should ask
			 * the user to make a selection. If we do get here anyway, return silently.
			 */
			return;
		}
		const text = $('#post-form textarea[name=text]').val();
		if (text) {
			reallySubmitPost(text, forumStatus);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	/**
	 * Submit a forum post
	 *
	 * @param text the non-empty body of the message
	 * @param forumStatus the status string
	 */
	function reallySubmitPost(text, forumStatus) {
		$('#post-form button').fadeOut();
		$('#post-form .input-group').fadeOut(); // subject line
		$('#forum-status-area').fadeOut();

		const xpath = $('#post-form input[name=xpath]').val();
		const locale = $('#post-form input[name=_]').val();
		const url = contextPath + "/SurveyAjax";
		const replyTo = $('#post-form input[name=replyTo]').val();
		const subj = $('#post-form input[name=subj]').val();

		const errorHandler = function(err) {
			const responseText = cldrStAjax.errResponseText(err);
			const post = $('.post').first();
			post.before("<p class='warn'>error! " + err + " " + responseText + "</p>");
		};
		const loadHandler = function(data) {
			if (data.err) {
				const post = $('.post').first();
				post.before("<p class='warn'>error: " + data.err + "</p>");
			} else if (data.ret && data.ret.length > 0) {
				const postModal = $('#post-modal');
				postModal.modal('hide');
				if (surveyCurrentSpecial && surveyCurrentSpecial === 'forum') {
					reloadV();
				} else {
					updateInfoPanelForumPosts(null);
				}
			} else {
				const post = $('.post').first();
				post.before("<i>Your post was added, #" + data.postId + " but could not be shown.</i>");
			}
		};
		const postData = {
			s: surveySessionId,
			"_": locale,
			replyTo: replyTo,
			xpath: xpath,
			text: text,
			subj: subj,
			forumStatus: forumStatus,
			what: "forum_post"
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler,
			postData: postData
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Create a DOM object referring to this set of forum posts
	 *
	 * @param posts the array of forum post objects, newest first
	 * @param context the string defining the context
	 *
	 * @return new DOM object
	 *
	 * TODO: shorten this function by moving code into subroutines. Also, postpone creating
	 * DOM elements until finished constructing the filtered list of threads, to make the code
	 * cleaner, faster, and more testable. If context is 'summary', all DOM element creation here
	 * is a waste of time. 
	 *
	 * Threading has been revised, so that the same locale+path can have multiple distinct threads,
	 * rather than always combining posts with the same locale+path into a single "thread".
	 * Reference: https://unicode-org.atlassian.net/browse/CLDR-13695
	 */
	function parseContent(posts, context) {

		const opts = getOptionsForContext(context);

		if (opts.fullSet) {
			postHash = {};
		}
		updatePostHash(posts);

		const postDivs = {}; //  postid -> div
		const topicDivs = {}; // xpath -> div or "#123" -> div

		// next, add threadIds and create the topic divs
		for (let num in posts) {
			const post = posts[num];
			post.threadId = getThreadId(post);

			if (!topicDivs[post.threadId]) {
				// add the topic div
				const topicDiv = document.createElement('div');
				topicDiv.className = 'well well-sm postTopic';
				const topicInfo = forumCreateChunk("", "h4", "postTopicInfo");
				if (opts.showItemLink) {
					topicDiv.appendChild(topicInfo);
					if (post.locale) {
						const localeLink = forumCreateChunk(locmap.getLocaleName(post.locale), "a", "localeName");
						if (post.locale != surveyCurrentLocale) {
							localeLink.href = linkToLocale(post.locale);
						}
						topicInfo.appendChild(localeLink);
					}
				}
				if (!post.xpath) {
					topicInfo.appendChild(forumCreateChunk(post2text(post.subject), "span", "topicSubject"));
				} else if (opts.showItemLink) {
					const itemLink = forumCreateChunk(forumStr("forum_item"), "a", "pull-right postItem glyphicon glyphicon-zoom-in");
					itemLink.href = "#/" + post.locale + "//" + post.xpath;
					topicInfo.appendChild(itemLink);
					(function(topicInfo) {
						const loadingMsg = forumCreateChunk(forumStr("loading"), "i", "loadingMsg");
						topicInfo.appendChild(loadingMsg);
						xpathMap.get({
							hex: post.xpath
						}, function(o) {
							if (o.result) {
								topicInfo.removeChild(loadingMsg);
								const itemPh = forumCreateChunk(xpathMap.formatPathHeader(o.result.ph), "span", "topicSubject");
								itemPh.title = o.result.path;
								topicInfo.appendChild(itemPh);
							}
						});
					})(topicInfo);
				}
				topicDivs[post.threadId] = topicDiv;
				topicDiv.id = "fthr_" + post.threadId;
			}
		}
		// Now, top to bottom, just create the post divs
		for (let num in posts) {
			const post = posts[num];

			const subpost = forumCreateChunk("", "div", "post");
			postDivs[post.id] = subpost;
			subpost.id = "fp" + post.id;

			const headingLine = forumCreateChunk("", "h4", "selected");

			// If post.posterInfo is undefined, don't crash; insert "[Poster no longer active]".
			if (!post.posterInfo) {
				headingLine.appendChild(forumCreateChunk("[Poster no longer active]", "span", ""));
			} else {
				/*
				 * TODO: encapsulate "createGravitar" dependency
				 */
				let gravitar;
				if (typeof createGravitar !== 'undefined') {
					gravitar = createGravitar(post.posterInfo);
				} else {
					gravitar = document.createTextNode('');
				}
				gravitar.className = "gravitar pull-left";
				subpost.appendChild(gravitar);
				/*
				 * TODO: encapsulate "surveyUser" dependency
				 */
				if (typeof surveyUser !== 'undefined' && post.posterInfo.id === surveyUser.id) {
					headingLine.appendChild(forumCreateChunk(forumStr("user_me"), "span", "forum-me"));
				} else {
					const usera = forumCreateChunk(post.posterInfo.name + ' ', "a", "");
					if (post.posterInfo.email) {
						usera.appendChild(forumCreateChunk("", "span", "glyphicon glyphicon-envelope"));
						usera.href = "mailto:" + post.posterInfo.email;
					}
					headingLine.appendChild(usera);
					headingLine.appendChild(document.createTextNode(' (' + post.posterInfo.org + ') '));
				}
				const userLevelChunk = forumCreateChunk(forumStr("userlevel_" + post.posterInfo.userlevelName), "span", "userLevelName label-info label");
				userLevelChunk.title = forumStr("userlevel_" + post.posterInfo.userlevelName + "_desc");
				headingLine.appendChild(userLevelChunk);
			}
			let date = fmtDateTime(post.date_long);
			if (post.version) {
				date = "[v" + post.version + "] " + date;
			}
			const dateChunk = forumCreateChunk(date, "span", "label label-primary pull-right forumLink");
			(function(post) {
				/*
				 * TODO: encapsulate "listenFor" and "reloadV" dependencies
				 */
				if (typeof listenFor === 'undefined') {
					return;
				}
				listenFor(dateChunk, "click", function(e) {
					if (post.locale && locmap.getLanguage(surveyCurrentLocale) != locmap.getLanguage(post.locale)) {
						surveyCurrentLocale = locmap.getLanguage(post.locale);
					}
					surveyCurrentPage = '';
					surveyCurrentId = post.id;
					replaceHash(false);
					if (surveyCurrentSpecial != 'forum') {
						surveyCurrentSpecial = 'forum';
						reloadV();
					}
					return stStopPropagation(e);
				});
			})(post);
			headingLine.appendChild(dateChunk);
			subpost.appendChild(headingLine);

			const subSubChunk = forumCreateChunk("", "div", "postHeaderInfoGroup");
			subpost.appendChild(subSubChunk); {
				const subChunk = forumCreateChunk("", "div", "postHeaderItem");
				subSubChunk.appendChild(subChunk);
				subChunk.appendChild(forumCreateChunk(post2text(post.subject), "b", "postSubject"));
			}

			// actual text
			const postText = post2text(post.text);
			const postContent = forumCreateChunk(postText, "div", "postContent");
			subpost.appendChild(postContent);

			subpost.appendChild(forumCreateChunk('【' + post.forumStatus + '】', 'div', ''));

			if (opts.showReplyButton) {
				const replyButton = forumCreateChunk(forumStr("forum_reply"), "button", "btn btn-default btn-sm");
				(function(post) {
					/*
					 * TODO: encapsulate "listenFor" dependency
					 */
					if (typeof listenFor === 'undefined') {
						return;
					}
					listenFor(replyButton, "click", function(e) {
						openPostOrReply({
							/*
							 * Don't specify locale or xpath for reply. Instead they will be set to
							 * match the original post in the thread.
							 */
							replyTo: post.id,
							replyData: post
						});
						stStopPropagation(e);
						return false;
					});
				})(post);
				subpost.appendChild(replyButton);
			}
		}
		// reparent any nodes that we can
		for (let num in posts) {
			const post = posts[num];
			if (post.parent != -1) {
				forumDebug("reparenting " + post.id + " to " + post.parent);
				if (postDivs[post.parent]) {
					if (!postDivs[post.parent].replies) {
						// add the "replies" area
						forumDebug("Adding replies area to " + post.parent);
						postDivs[post.parent].replies = forumCreateChunk("", "div", "postReplies");
						postDivs[post.parent].appendChild(postDivs[post.parent].replies);
					}
					// add to new location
					postDivs[post.parent].replies.appendChild(postDivs[post.id]);
				} else {
					// The parent of this post was deleted.
					forumDebug("The parent of post #" + post.id + " is " + post.parent + " but it was deleted or not visible");
					// link it in somewhere
					topicDivs[post.threadId].appendChild(postDivs[post.id]);
				}
			} else {
				// 'top level' post
				topicDivs[post.threadId].appendChild(postDivs[post.id]);
			}
		}
		return filterAndAssembleForumThreads(posts, topicDivs, opts.applyFilter, opts.showThreadCount);
	}

	/**
	 * Get an object whose properties define the parseContent options to be used for a particular
	 * context in which parseContent is called
	 *
	 * @param context the string defining the context:
	 *
	 *   'main' for the context in which "Forum" is chosen from the left sidebar
	 *
	 *   'info' for the "Info Panel" context (either main vetting view row, or Dashboard "Fix" button)
	 *
	 *   'new' for creation of a new post or reply
	 *
	 * @return an object with these properties:
	 *
	 *   showItemLink = true if there should be an "item" (xpath) link
	 *
	 *   showReplyButton = true if there should be a reply button
	 *
	 *   fullSet = true if this is a full set of posts
	 *
	 *   applyFilter = true if the currently menu-selected filter should be applied
	 *
	 *   showThreadCount = true to display the number of threads
	 */
	function getOptionsForContext(context) {
		const opts = getDefaultParseOptions();
		if (context === 'main') {
			opts.showItemLink = true;
			opts.showReplyButton = true;
			opts.applyFilter = true;
			opts.showThreadCount = true;
		} else if (context === 'summary') {
			opts.applyFilter = true;
		} else if (context === 'info') {
			opts.showReplyButton = true;
		} else if (context === 'new') {
			/*
			 * posts may have zero, one, or more elements here, for parent(s),
			 * if any, of a new post in the process of being created
			 */
			opts.fullSet = false;
		} else {
			console.log('Unrecognized context in getOptionsForContext: ' + context)
		}
		return opts;
	}

	/**
	 * Get the default parseContent options
	 *
	 * @return a new object with the default properties
	 */
	function getDefaultParseOptions() {
		const opts = {};
		opts.showItemLink = false;
		opts.showReplyButton = false;
		opts.fullSet = true;
		opts.applyFilter = false;
		opts.showThreadCount = false;
		return opts;
	}

	/**
	 * Update the postHash mapping from post id to post object
	 *
	 * @param posts the array of posts
	 */
	function updatePostHash(posts) {
		for (let num in posts) {
			postHash[posts[num].id] = posts[num];
		}
		forumUpdateTime = Date.now();
	}

	/**
	 * Convert the given text by replacing some html with plain text
	 *
	 * @param the plain text
	 */
	function post2text(text) {
		if (text === undefined || text === null) {
			text = "(empty)";
		}
		let out = text;
		out = out.replace(/<p>/g, '\n');
		out = out.replace(/&quot;/g, '"');
		out = out.replace(/&lt;/g, '<');
		out = out.replace(/&gt;/g, '>');
		out = out.replace(/&amp;/g, '&');
		return out;
	}

	/**
	 * Create a DOM object with the specified text, tag, and HTML class.
	 *
	 * @param text textual content of the new object, or null for none
	 * @param tag which element type to create, or null for "span"
	 * @param className CSS className, or null for none.
	 * @return new DOM object
	 *
	 * This duplicated a function in survey.js; copied here to avoid the dependency, at least while testing/refactoring
	 */
	function forumCreateChunk(text, tag, className) {
		if (!tag) {
			tag = "span";
		}
		const chunk = document.createElement(tag);
		if (className) {
			chunk.className = className;
		}
		if (text) {
			chunk.appendChild(document.createTextNode(text));
		}
		return chunk;
	}

	/**
	 * Get the "thread id" for the given post.
	 *
	 * For a post with a parent, the thread id is the same as the thread id of the parent.
	 *
	 * For post without a parent, the thread id is like "aa|1234", where aa is the locale and 1234 is the post id.
	 *
	 * Caution: strangely, a post may have a different locale than the first post in its thread.
	 * For example, even though post 32034 is fr_CA, its child 32036 is fr.
	 * The thread id must use the locale of of the first post, for consistency.
	 *
	 * @param post the post object
	 * @return the thread id string
	 */
	function getThreadId(post) {
		const firstPost = getFirstPostInThread(post);
		return firstPost.locale + "|" + firstPost.id;
	}

	/**
	 * Get the first (original) post in the thread containing this post
	 *
	 * @param post the post object
	 * @return the first post in the thread
	 */
	function getFirstPostInThread(post) {
		while (post.parent >= 0 && postHash[post.parent]) {
			post = postHash[post.parent];
		}
		return post;
	}

	/**
	 * Filter the forum threads and assemble them into a new document fragment,
	 * ordering threads from newest to oldest, determining the time of each thread
	 * by the newest post it contains
	 *
	 * @param posts the array of post objects, from newest to oldest
	 * @param topicDivs the array of thread elements, indexed by threadId
	 * @param applyFilter true if the currently menu-selected filter should be applied
	 * @param showThreadCount true to display the number of threads
	 * @return the new document fragment
	 */
	function filterAndAssembleForumThreads(posts, topicDivs, applyFilter, showThreadCount) {

		let filteredArray = cldrStForumFilter.getFilteredThreadIds(posts, applyFilter);
		const forumDiv = document.createDocumentFragment();
		let countEl = null;
		if (showThreadCount) {
			countEl = document.createElement('h4');
			forumDiv.append(countEl);
		}
		let threadCount = 0;
		posts.forEach(function(post) {
			if (filteredArray.includes(post.threadId)) {
				++threadCount;
				/*
				 * Append the div for this threadId, then remove this threadId
				 * from filteredArray to prevent appending the same div again
				 * (which would move the div to the bottom, not duplicate it).
				 */
				forumDiv.append(topicDivs[post.threadId]);
				filteredArray = filteredArray.filter(id => (id !== post.threadId));
			}
		});
		if (showThreadCount) {
			countEl.innerHTML = threadCount + ((threadCount === 1) ? ' thread' : ' threads');
		}
		return forumDiv;
	}

	/**
	 * Convert the given short string into a human-readable string.
	 *
	 * TODO: encapsulate "stui" dependency better
	 *
	 * @param s the short string, like "forum_item" or "forum_reply"
	 * @return the human-readable string like "Item" or "Reply"
	 */
	function forumStr(s) {
		if (typeof stui !== 'undefined') {
			return stui.str(s);
		}
		return s;
	}

	/**
	 * Format a date and time for display in a forum post
	 *
	 * @param x the number of seconds since 1970-01-01
	 * @returns the formatted date and time as a string, like "2018-05-16 13:45"
	 */
	function fmtDateTime(x) {
		const d = new Date(x);

		function pad(n) {
			return (n < 10) ? '0' + n : n;
		}
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
			' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
	}

	/**
	 * Get a piece of html text summarizing the current Forum statistics
	 *
	 * @param locale the locale string
	 * @return the html
	 */
	function getForumSummaryHtml(locale) {
		setLocale(locale);
		return reallyGetForumSummaryHtml(true /* canDoAjax */);
	}

	/**
	 * Get a piece of html text summarizing the current Forum statistics
	 *
	 * @param canDoAjax true to call loadForumForSummaryOnly if needed, false otherwise; should
	 *                  be false if the caller is the loadHandler for loadForumForSummaryOnly,
	 *                  to prevent endless back-and-forth if things go wrong 
	 * @return the html
	 */
	function reallyGetForumSummaryHtml(canDoAjax) {
		const id = 'forumSummary';
		let html = "<div id='" + id + "'>\n";
		if (!forumUpdateTime) {
			if (canDoAjax) {
				html += "<p>Loading Forum Summary...</p>\n";
				loadForumForSummaryOnly(forumLocale, id)
			} else {
				html += "<p>Load failed</p>n";
			}
		} else {
			if (FORUM_DEBUG) {
				html += "<p>Retrieved " + fmtDateTime(forumUpdateTime) + "</p>\n";				
			}
			if (cldrStForumFilter) {
				const c = cldrStForumFilter.getFilteredThreadCounts();
				html += "<ul>\n";
				Object.keys(c).forEach(function(k) {
					html += "<li>" + k + ": " + c[k] + "</li>\n";
				});
				html += "</ul>\n";
			}
		}
		html += '</div>\n';
		return html;
	}

	/**
	 * Fetch the Forum data from the server, and show a summary
	 *
	 * @param locale the locale
	 * @param id the id of the element to display the summary
	 */
	function loadForumForSummaryOnly(locale, id) {
		if (typeof cldrStAjax === 'undefined') {
			return;
		}
		setLocale(locale);
		const url = getLoadForumUrl();
		const errorHandler = function(err) {
			const el = document.getElementById(id);
			if (el) {
				el.innerHTML = cldrStAjax.errResponseText(err);
			}
		};
		const loadHandler = function(json) {
			const el = document.getElementById(id);
			if (!el) {
				return;
			}
			if (json.err) {
				el.innerHTML = 'Error';
				return;
			}
			const posts = json.ret;
			parseContent(posts, 'summary');
			el.innerHTML = reallyGetForumSummaryHtml(false /* do not reload recursively */); // after parseContent
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Load or reload the main Forum page
	 */
	function reload() {
		window.surveyCurrentSpecial = 'forum';
		window.surveyCurrentId = '';
		window.surveyCurrentPage = '';
		reloadV();
	}

	/**
	 * Get the URL to use for loading the Forum
	 */
	function getLoadForumUrl() {
		if (typeof surveySessionId === 'undefined') {
			console.log('Error: surveySessionId undefined in getLoadForumUrl');
			return '';
		}
		return 'SurveyAjax?s=' + surveySessionId + '&what=forum_fetch&xpath=0&_=' + forumLocale;
	}

	/**
	 * If the given locale is not the one we've already loaded, switch to it,
	 * initializing data to avoid using data for the wrong locale
	 *
	 * @param locale the locale string, like "fr_CA" (surveyCurrentLocale)
	 */
	function setLocale(locale) {
		if (locale !== forumLocale) {
			forumLocale = locale;
			forumUpdateTime = null;
			postHash = {};
		}
	}

	/*
	 * Make only these functions accessible from other files:
	 */
	return {
		openPostOrReply: openPostOrReply,
		parseContent: parseContent,
		getForumSummaryHtml: getForumSummaryHtml,
		loadForum: loadForum,
		reload: reload,
		/*
		 * The following are meant to be accessible for unit testing only:
		 */
		test: {
			postStatusMenu: postStatusMenu,
		}
	};
})();
